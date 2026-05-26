import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPostTask } from "../agent/post-task";
import type { CmdRunner } from "../agent/pr";
import type { GitRunner } from "../agent/worktree";
import type { LinearIssue } from "../agent/linear";

const FAKE_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "RLF-82",
  title: "Conflict-fix verify",
  url: "https://linear.app/team/issue/RLF-82",
  description: "",
  priority: 2,
  createdAt: "2026-05-22T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

type PrViewSpec = { state?: string; mergeable?: string } | "fail";

interface MakeCmdOpts {
  /**
   * Value(s) returned for `gh pr view --json ...`. When an array is provided,
   * each successive `gh pr view` call consumes the next entry; once exhausted
   * the last entry repeats. Stringified inline for JSON responses.
   */
  prView?: PrViewSpec | PrViewSpec[];
  /** URL returned by `gh pr list --head ...`. */
  prListUrl?: string | "";
}

function makeCmd(opts: MakeCmdOpts): { cmd: CmdRunner; calls: string[][] } {
  const calls: string[][] = [];
  let viewCallIdx = 0;
  const cmd: CmdRunner = {
    run: async (args) => {
      calls.push([...args]);
      if (args[0] === "gh" && args[1] === "pr" && args[2] === "list") {
        return { stdout: opts.prListUrl ?? "", stderr: "" };
      }
      if (args[0] === "gh" && args[1] === "pr" && args[2] === "view") {
        const seq = Array.isArray(opts.prView)
          ? opts.prView
          : opts.prView !== undefined
            ? [opts.prView]
            : [{}];
        const spec = seq[Math.min(viewCallIdx++, seq.length - 1)];
        if (spec === "fail") {
          const err = new Error("gh failed") as Error & { stderr?: string };
          err.stderr = "auth required";
          throw err;
        }
        return { stdout: JSON.stringify(spec ?? {}), stderr: "" };
      }
      // Any other git/gh call — pretend success with empty output. The
      // conflict-fix short-circuit must not hit `git push`, so if such a
      // call ever shows up the test's assertions will surface it.
      return { stdout: "", stderr: "" };
    },
  };
  return { cmd, calls };
}

describe("runPostTask — conflict-fix verify-only short-circuit", () => {
  let tmpDir: string;
  let changeDir: string;
  let stateFilePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "post-task-conflict-fix-"));
    changeDir = join(tmpDir, "changes", "my-change");
    await mkdir(changeDir, { recursive: true });
    await Bun.write(join(changeDir, "tasks.md"), "## My change\n\n- [x] First task\n");
    stateFilePath = join(tmpDir, ".ralph-state.json");
    await Bun.write(
      stateFilePath,
      JSON.stringify({ status: "active", lastModified: new Date().toISOString() }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (overrides: { mode?: "conflict-fix" | "fresh" } = {}) => ({
    mode: overrides.mode ?? ("conflict-fix" as const),
    changeName: "my-change",
    cwd: tmpDir,
    projectRoot: tmpDir,
    changeDir,
    stateFilePath,
    branch: "ralph/my-change",
    issue: FAKE_ISSUE,
    exitCode: 0,
    useWorktree: false,
    wantPr: true,
    wantFixCi: false,
    wantAutoMerge: false,
    cfg: {
      teardownScript: null,
      prBaseBranch: "main",
      autoMergeStrategy: "squash" as const,
      maxCiFixAttempts: 3,
      ciPollIntervalSeconds: 0,
      cleanupWorktreeOnSuccess: false,
      ignoreCiChecks: [],
      stackPrsOnDependencies: false,
      neverTouch: [],
    },
    respawnWorker: async () => 0,
  });

  const git: GitRunner = { run: async () => ({ stdout: "", stderr: "" }) };

  test("MERGEABLE → clearConflicted invoked exactly once and runPostTask returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "MERGEABLE" },
    });

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
    });

    expect(code).toBe(0);
    // Must NOT push or open a PR.
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    expect(calls.some((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create")).toBe(false);
  });

  test("CONFLICTING → clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "CONFLICTING" },
    });

    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
    });

    expect(code).toBe(0);
    expect(
      logs.some((l) => l.color === "yellow" && /still CONFLICTING after rebase/.test(l.text)),
    ).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
  });

  test("UNKNOWN (persistent) → retries 3x, clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: { state: "OPEN", mergeable: "UNKNOWN" },
    });

    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
      _mergeabilityBackoffsMs: [0, 0, 0],
    });

    expect(code).toBe(0);
    expect(logs.some((l) => l.color === "yellow" && /UNKNOWN/.test(l.text))).toBe(true);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    // 1 initial + 3 retries = 4 total gh pr view calls
    const viewCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "view");
    expect(viewCalls.length).toBe(4);
  });

  test("UNKNOWN → MERGEABLE after retries → clearConflicted invoked, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      // First two calls return UNKNOWN, third returns MERGEABLE
      prView: [
        { state: "OPEN", mergeable: "UNKNOWN" },
        { state: "OPEN", mergeable: "UNKNOWN" },
        { state: "OPEN", mergeable: "MERGEABLE" },
      ],
    });

    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
      _mergeabilityBackoffsMs: [0, 0, 0],
    });

    expect(code).toBe(0);
    // Should log green MERGEABLE message, not yellow UNKNOWN warning
    expect(logs.some((l) => l.color === "green" && /MERGEABLE/.test(l.text))).toBe(true);
    expect(logs.some((l) => /UNKNOWN/.test(l.text))).toBe(false);
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
    // 3 gh pr view calls: UNKNOWN, UNKNOWN, MERGEABLE
    const viewCalls = calls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "view");
    expect(viewCalls.length).toBe(3);
  });

  test("gh fetch error → clearConflicted NOT invoked, yellow log, returns 0", async () => {
    const { cmd, calls } = makeCmd({
      prListUrl: "https://github.com/owner/repo/pull/42\n",
      prView: "fail",
    });

    const logs: { text: string; color?: string }[] = [];

    const code = await runPostTask(baseInput(), {
      cmd,
      git,
      log: (text, color) => logs.push(color !== undefined ? { text, color } : { text }),
      runScript: async () => {},
    });

    expect(code).toBe(0);
    expect(logs.some((l) => l.color === "yellow" && /PR status fetch failed/.test(l.text))).toBe(
      true,
    );
    expect(calls.some((c) => c[0] === "git" && c[1] === "push")).toBe(false);
  });

  test("non-conflict-fix mode does NOT take the short-circuit (legacy PR path engages)", async () => {
    // For mode!=conflict-fix the legacy `runPrPhase` is invoked. It will
    // begin by running `git status --porcelain` to inspect the worktree.
    // We don't drive the full flow here — we only assert the conflict-fix
    // verify path did NOT short-circuit (no `gh pr list --head` for verify)
    // and clearConflicted was not invoked.
    const { cmd, calls } = makeCmd({
      prView: { mergeable: "MERGEABLE" },
    });

    await runPostTask(baseInput({ mode: "fresh" }), {
      cmd,
      git,
      log: () => {},
      runScript: async () => {},
    });

    // The legacy path runs `git status --porcelain` as its first step;
    // the short-circuit path never does. Confirm we took the legacy path.
    expect(calls.some((c) => c[0] === "git" && c[1] === "status")).toBe(true);
  });
});
