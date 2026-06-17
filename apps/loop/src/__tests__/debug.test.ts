import { describe, expect, test } from "bun:test";
import {
  parseTextLog,
  parseJsonlLog,
  detectDebugStuck,
  resolveDebugTarget,
  runDebug,
} from "../debug";
import type { DebugIo, BinaryInfo, LinearIssueInfo, PrInfo } from "../debug-io";

// `parseJsonlLog` reads the project-level `agent.log` (a JSONL stream of
// `RalphEvent` values) into the debug timeline. The `JsonlEntry` view it
// parses against is derived from the canonical `RalphEvent` union (RLF-254),
// so these assertions also pin the worker_pr wire shape: the PR url lives
// under `url`, with `prUrl` honoured only for pre-8a historical lines.

const TS = 1_700_000_000_000;

describe("parseJsonlLog — worker_pr rendering", () => {
  test("renders a worker_pr line carrying the canonical `url` field", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "my-change",
      url: "https://github.com/o/r/pull/7",
    });

    const [entry, ...rest] = parseJsonlLog(line);

    expect(rest).toHaveLength(0);
    expect(entry?.type).toBe("pr");
    expect(entry?.text).toBe("my-change: PR → https://github.com/o/r/pull/7");
  });

  test("falls back to the legacy `prUrl` field for historical lines", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "old-change",
      prUrl: "https://github.com/o/r/pull/3",
    });

    const [entry] = parseJsonlLog(line);

    expect(entry?.type).toBe("pr");
    expect(entry?.text).toBe("old-change: PR → https://github.com/o/r/pull/3");
  });

  test("filters worker_pr lines belonging to other changes", () => {
    const line = JSON.stringify({
      type: "worker_pr",
      ts: TS,
      changeName: "other-change",
      url: "https://github.com/o/r/pull/9",
    });

    expect(parseJsonlLog(line, "my-change")).toHaveLength(0);
  });
});

describe("parseJsonlLog — event variants", () => {
  const at = (type: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ type, ts: TS, changeName: "c", ...extra });

  test("renders each known event type and drops unknown / malformed lines", () => {
    const content = [
      at("started", { version: "9.9.9" }),
      at("stopped"),
      at("worker_started"),
      at("worker_phase", { phase: "working", detail: "step 1" }),
      at("worker_phase", { phase: "working" }), // no-detail branch
      at("worker_cmd_start", { cmd: ["bun", "test", "a", "b", "c"] }),
      at("worker_cmd_end", { cmd: ["bun", "test"], durationMs: 12, ok: true }),
      at("worker_exited", { exitCode: 0 }),
      at("log", { text: "hello" }),
      at("poll_done", { found: 3, added: 1 }),
      at("totally_unknown_type"),
      "not json at all",
      JSON.stringify({ type: "log", ts: "not-a-date", text: "x" }), // invalid ts
    ].join("\n");

    const lines = parseJsonlLog(content);
    const texts = lines.map((l) => l.text);

    expect(texts).toContain("agent started v9.9.9");
    expect(texts).toContain("agent stopped");
    expect(texts).toContain("c: worker spawned");
    expect(texts).toContain("c: working (step 1)");
    expect(texts).toContain("c: working");
    expect(texts).toContain("c: → bun test a b");
    expect(texts).toContain("c: ← bun test (12ms, ok)");
    expect(texts).toContain("c: exited (code 0)");
    expect(texts).toContain("hello");
    expect(texts).toContain("poll: found=3 added=1");
    // unknown type, non-json, and invalid-ts lines are dropped
    expect(lines).toHaveLength(10);
  });
});

describe("parseTextLog", () => {
  test("parses well-formed lines and skips malformed / bad-timestamp ones", () => {
    const content = [
      "[2026-01-01T00:00:00.000Z] [phase] working on it",
      "not a log line",
      "[nope] [phase] bad timestamp",
    ].join("\n");

    const lines = parseTextLog(content);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.type).toBe("phase");
    expect(lines[0]!.text).toBe("working on it");
  });
});

describe("detectDebugStuck", () => {
  const phaseLine = (i: number, phase = "c: waiting for CI") => ({
    ts: new Date(TS + i * 60_000),
    type: "phase",
    text: phase,
  });

  test("returns null below the minimum line count", () => {
    expect(detectDebugStuck([phaseLine(0)])).toBeNull();
  });

  test("returns null when recent phases differ", () => {
    const lines = Array.from({ length: 25 }, (_, i) => phaseLine(i, i % 2 === 0 ? "c: a" : "c: b"));
    expect(detectDebugStuck(lines)).toBeNull();
  });

  test("detects a stuck phase and extracts the watched PR url from a pr entry", () => {
    const lines = [
      { ts: new Date(TS), type: "pr", text: "c: PR → https://github.com/o/r/pull/5" },
      ...Array.from({ length: 24 }, (_, i) => phaseLine(i + 1)),
    ];
    const stuck = detectDebugStuck(lines);
    expect(stuck?.phase).toBe("waiting for CI");
    expect(stuck?.watchingPrUrl).toBe("https://github.com/o/r/pull/5");
    expect(stuck!.count).toBeGreaterThanOrEqual(20);
  });

  test("falls back to a gh mergeable cmd entry for the watched url", () => {
    const lines = [
      {
        ts: new Date(TS),
        type: "cmd",
        text: "c: → gh pr view https://github.com/o/r/pull/8 mergeable",
      },
      ...Array.from({ length: 24 }, (_, i) => phaseLine(i + 1)),
    ];
    expect(detectDebugStuck(lines)?.watchingPrUrl).toBe("https://github.com/o/r/pull/8");
  });

  test("returns null when fewer than five recent phase entries", () => {
    const lines = Array.from({ length: 15 }, (_, i) => ({
      ts: new Date(TS + i * 1000),
      type: "coord",
      text: "noise",
    }));
    expect(detectDebugStuck(lines)).toBeNull();
  });
});

describe("resolveDebugTarget", () => {
  const line = (text: string) => ({ ts: new Date(TS), type: "x", text });

  test("name only: resolves identifier from a spawn line", () => {
    const r = resolveDebugTarget([line("▶ COD-42 → my-change")], { name: "my-change" });
    expect(r).toEqual({ changeName: "my-change", identifier: "COD-42" });
  });

  test("name only: resolves identifier from a COD- reference", () => {
    const r = resolveDebugTarget([line("my-change picked up COD-7")], { name: "my-change" });
    expect(r.identifier).toBe("COD-7");
  });

  test("name only: identifier undefined when nothing matches", () => {
    expect(resolveDebugTarget([line("noise")], { name: "my-change" }).identifier).toBeUndefined();
  });

  test("issue only: resolves changeName from a cod- slug", () => {
    const r = resolveDebugTarget([line("cod-42-do-the-thing started")], { issue: "COD-42" });
    expect(r.changeName).toBe("cod-42-do-the-thing");
    expect(r.identifier).toBe("COD-42");
  });

  test("issue only: resolves changeName from a spawn line", () => {
    const r = resolveDebugTarget([line("▶ COD-9 → some-change")], { issue: "COD-9" });
    expect(r.changeName).toBe("some-change");
  });

  test("issue only: falls back to the issue id when unmatched", () => {
    expect(resolveDebugTarget([line("noise")], { issue: "COD-1" }).changeName).toBe("COD-1");
  });

  test("name and issue both given: returns them verbatim", () => {
    expect(resolveDebugTarget([], { name: "n", issue: "COD-3" })).toEqual({
      changeName: "n",
      identifier: "COD-3",
    });
  });
});

// ---------------------------------------------------------------------------
// runDebug — driven end-to-end through an injected fake DebugIo.
// ---------------------------------------------------------------------------

interface FakeIoOptions {
  files?: Record<string, string>;
  pathExists?: boolean;
  binary?: BinaryInfo | null;
  linearKey?: string | undefined;
  linearIssue?: LinearIssueInfo | null;
  pr?: PrInfo | null;
  mergeable?: string | null;
}

function makeFakeIo(opts: FakeIoOptions = {}): {
  io: DebugIo;
  out: string[];
  errs: string[];
  exits: number[];
} {
  const out: string[] = [];
  const errs: string[] = [];
  const exits: number[] = [];
  const files = opts.files ?? {};
  const io: DebugIo = {
    readOptionalText: async (path) => (path in files ? files[path]! : null),
    pathExists: async () => opts.pathExists ?? false,
    inspectBinary: async () => opts.binary ?? null,
    fetchLinearIssue: async () => opts.linearIssue ?? null,
    fetchGithubPr: async () => opts.pr ?? null,
    fetchMergeableNow: () => opts.mergeable ?? null,
    linearApiKey: () => opts.linearKey,
    agentLogPath: () => "/agent.log",
    out: (line) => out.push(line),
    errOut: (line) => errs.push(line),
    exit: ((code: number) => {
      exits.push(code);
      throw new Error("__debug_exit__");
    }) as DebugIo["exit"],
  };
  return { io, out, errs, exits };
}

const jsonl = (entries: Record<string, unknown>[]) =>
  entries
    .map((e, i) => JSON.stringify({ ts: TS + i * 60_000, changeName: "my-change", ...e }))
    .join("\n");

describe("runDebug", () => {
  test("exits 1 when no change name can be resolved", async () => {
    const { io, errs, exits } = makeFakeIo();
    await expect(runDebug({ projectRoot: "/proj" }, io)).rejects.toThrow("__debug_exit__");
    expect(exits).toEqual([1]);
    expect(errs.join("")).toContain("Could not resolve change name");
  });

  test("reports an empty timeline when no logs exist", async () => {
    const { io, out } = makeFakeIo();
    await runDebug({ name: "my-change", projectRoot: "/proj" }, io);
    const text = out.join("\n");
    expect(text).toContain("Ralph Debug: my-change");
    expect(text).toContain("(no log entries found)");
    expect(text).toContain("(no PR found for branch ralph/my-change)");
    expect(text).toContain("(unknown identifier");
  });

  test("renders a full timeline, binary, Linear, PR and diagnosis", async () => {
    const files = {
      "/proj/.ralph/agent.log": jsonl([
        { type: "worker_started" },
        { type: "worker_pr", url: "https://github.com/o/r/pull/1" },
        { type: "worker_exited", exitCode: 71 },
        { type: "log", text: "setError applied" },
        { type: "log", text: "setConflicted applied" },
      ]),
    };
    const { io, out } = makeFakeIo({
      files,
      binary: { path: "/proj/.ralph/bin/cli.js", embeddedVersion: "2.20.0", builtAt: new Date(TS) },
      linearKey: "key",
      linearIssue: {
        identifier: "COD-1",
        title: "Do the thing",
        url: "https://linear.app/x",
        state: { name: "In Progress", type: "started" },
        labels: { nodes: [{ name: "ralph:error" }] },
      },
      pr: {
        number: 5,
        title: "PR",
        url: "https://github.com/o/r/pull/5",
        state: "OPEN",
        mergeable: "CONFLICTING",
        checks: [
          { name: "ci", state: "COMPLETED", conclusion: "FAILURE" },
          { name: "lint", state: "IN_PROGRESS", conclusion: null },
        ],
      },
      pathExists: true,
    });

    await runDebug({ name: "my-change", issue: "COD-1", projectRoot: "/proj" }, io);
    const text = out.join("\n");

    expect(text).toContain("Installed binary");
    expect(text).toContain("Embedded version : 2.20.0");
    expect(text).toContain("Title  : Do the thing");
    expect(text).toContain("Labels : ralph:error");
    expect(text).toContain("PR #5");
    expect(text).toContain("✗ ci");
    expect(text).toContain("⧗ lint");
    expect(text).toContain("Exit code  : 71 — push or PR creation failed");
    expect(text).toContain("setError applied — issue is quarantined");
    expect(text).toContain("setConflicted applied");
    expect(text).toContain("PR currently has merge conflicts");
    expect(text).toContain("PR has failing CI checks");
    expect(text).toContain("Worktree   : /proj/.ralph/worktrees/my-change");
  });

  test("diagnoses a stuck mergeable loop with an outdated binary", async () => {
    const phases = Array.from({ length: 24 }, () => ({
      type: "worker_phase",
      phase: "waiting for CI",
    }));
    const files = {
      "/proj/.ralph/agent.log": jsonl([
        { type: "worker_pr", url: "https://github.com/o/r/pull/9" },
        ...phases,
      ]),
    };
    const { io, out } = makeFakeIo({
      files,
      binary: { path: "/b", embeddedVersion: "2.0.0", builtAt: undefined },
      mergeable: "MERGEABLE",
    });

    await runDebug({ name: "my-change", projectRoot: "/proj" }, io);
    const text = out.join("\n");

    expect(text).toContain("STUCK in waiting for CI");
    expect(text).toContain("Mergeable : MERGEABLE (live fetch)");
    expect(text).toContain("Local binary is v2.0.0");
    expect(text).toMatch(/↺ .* waiting for CI/);
  });

  test("Linear branch: fetch returns null surfaces an error line", async () => {
    const files = {
      "/proj/.ralph/agent.log": jsonl([{ type: "log", text: "anything COD-1" }]),
    };
    const { io, out } = makeFakeIo({ files, linearKey: "key", linearIssue: null });
    await runDebug({ name: "my-change", issue: "COD-1", projectRoot: "/proj" }, io);
    expect(out.join("\n")).toContain("Could not fetch COD-1 from Linear");
  });

  test("PR not found but a watched url yields a live mergeability probe", async () => {
    const phases = Array.from({ length: 24 }, () => ({
      type: "worker_phase",
      phase: "waiting",
    }));
    const files = {
      "/proj/.ralph/agent.log": jsonl([
        { type: "worker_pr", url: "https://github.com/o/r/pull/2" },
        ...phases,
      ]),
    };
    const { io, out } = makeFakeIo({ files, pr: null, mergeable: "UNKNOWN" });
    await runDebug({ name: "my-change", projectRoot: "/proj" }, io);
    const text = out.join("\n");
    expect(text).toContain("Watching : https://github.com/o/r/pull/2");
    expect(text).toContain("Mergeable: UNKNOWN");
  });

  test("reports a binary version mismatch against the agent-started log line", async () => {
    const files = {
      "/agent.log": "[2026-01-01T00:00:00.000Z] [agent] my-change agent started v3.1.0",
    };
    const { io, out } = makeFakeIo({
      files,
      binary: { path: "/b", embeddedVersion: "2.9.9", builtAt: undefined },
    });
    await runDebug({ name: "my-change", projectRoot: "/proj" }, io);
    expect(out.join("\n")).toContain("Version mismatch: binary says v2.9.9, agent reported v3.1.0");
  });
});
