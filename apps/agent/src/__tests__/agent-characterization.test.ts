/**
 * RLF-89 Stage-0 — Characterization tests (regression net).
 *
 * Pins observable behavior of `buildAgentCoordinator` + `coord.pollOnce()`
 * across seven scenarios using the same fake-harness pattern as
 * `agent-integration.test.ts`. Three scenarios are pinned with
 * `test.failing(...)` to encode bugs that Stage 2 will flip from red to
 * green by removing the `.failing` marker.
 *
 * Bun 1.3.14 supports `test.failing`, confirmed in the loop before this
 * file was authored. No `expect(...).toThrow()` fallback is needed.
 *
 * Stage-0 scope note: today's coordinator has 4 spawn modes (fresh,
 * resume, conflict-fix, review) and a flat Todo→InProgress→Done
 * lifecycle. The conceptual names in the scenario titles ("approval",
 * "implement", "design", "ci-fix") describe Stage-2 terminology — the
 * green-test bodies assert what the code does TODAY, and the `.failing`
 * bodies assert what Stage-2 SHOULD do (encoded so flipping the marker
 * is the only edit needed).
 *
 * Scenarios (filled in across the loop, one per iteration):
 *   1. new ticket → approval → implement → done                  (green, goldens)
 *   2. new ticket → revise → design → approval → implement       (green)
 *   3. gated ticket + PR conflicted → conflict-fix wins          (test.failing)
 *   4. gated ticket + CI failing → ci-fix wins                   (test.failing)
 *   5. approval persisted + tasks reset for conflict-fix         (test.failing)
 *   6. round-cap exhaustion → stuck                              (green)
 *   7. finished + PR conflicting → conflict-fix                  (green)
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

// PostHog capture seam.
//
// `apps/agent/src/agent/coordinator.ts` imports `capture` from
// `@ralphy/telemetry`. We replace the whole telemetry module with a
// fake that pushes every `capture()` call into the `capturedTelemetry`
// array below. Scenarios that want to assert telemetry behavior snap
// a slice of this array around their poll calls; scenario 1 also
// diffs the slice against a golden file. `mock.module(...)` must
// appear before the imports that pull in coordinator.ts (any import
// from `../agent/wire`).
interface CapturedTelemetry {
  event: string;
  properties: Record<string, unknown> | undefined;
}
const capturedTelemetry: CapturedTelemetry[] = [];
mock.module("@ralphy/telemetry", () => ({
  capture: (event: string, properties?: Record<string, unknown>) => {
    capturedTelemetry.push({ event, properties });
  },
  captureError: (event: string, error: unknown, properties?: Record<string, unknown>) => {
    const err = error instanceof Error ? error : new Error(String(error));
    capturedTelemetry.push({
      event,
      properties: {
        ...properties,
        error_message: err.message,
        error_name: err.name,
        error_stack: err.stack,
      },
    });
  },
  init: async () => {},
  shutdown: async () => {},
  setDefaultProperties: () => {},
}));

import { parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-char-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fakes (copied from agent-integration.test.ts; kept inline per design.md
// "Extracted only if the test file would otherwise exceed ~600 lines")
// ---------------------------------------------------------------------------

async function writeWorkflow(dir: string, frontmatter: unknown): Promise<void> {
  await Bun.write(join(dir, "WORKFLOW.md"), `---\n${YAML.stringify(frontmatter)}---\n`);
}

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  labels: Set<string>;
  priority: number;
  createdAt?: string;
}

class FakeLinear {
  issues = new Map<string, FakeIssue>();
  comments: { issueId: string; body: string }[] = [];
  /** Externally-seeded comments returned to `fetchIssueComments` for a given
   *  issue. Scenario 2 uses this to inject `@ralphy revise: <reason>` so the
   *  confirmation flow's comment scan picks it up. */
  externalComments = new Map<
    string,
    {
      id: string;
      body: string;
      createdAt: string;
      user: { name: string; email: string | null } | null;
    }[]
  >();
  reactions: { commentId: string; emoji: string }[] = [];
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  descriptionMutations: { issueId: string; description: string }[] = [];
  labelIds = new Map<string, string>();
  stateIds = new Map<string, string>();

  add(issue: FakeIssue): void {
    this.issues.set(issue.id, issue);
  }

  addExternalComment(
    issueId: string,
    comment: { id: string; body: string; createdAt: string; userName?: string },
  ): void {
    const bucket = this.externalComments.get(issueId) ?? [];
    bucket.push({
      id: comment.id,
      body: comment.body,
      createdAt: comment.createdAt,
      user: { name: comment.userName ?? "tester", email: null },
    });
    this.externalComments.set(issueId, bucket);
  }

  matches(issue: FakeIssue, filter: Record<string, unknown> | undefined): boolean {
    if (!filter) return true;
    if (filter.or) {
      return (filter.or as Record<string, unknown>[]).some((b) => this.matches(issue, b));
    }
    if (filter.and) {
      return (filter.and as Record<string, unknown>[]).every((b) => this.matches(issue, b));
    }
    if (filter.state) {
      const s = filter.state as { name?: { in?: string[]; nin?: string[] } };
      if (s.name?.in && !s.name.in.includes(issue.state.name)) return false;
      if (s.name?.nin && s.name.nin.includes(issue.state.name)) return false;
    }
    if (filter.labels) {
      const l = filter.labels as {
        some?: { name?: { in?: string[] } };
        every?: { name?: { nin?: string[] } };
      };
      if (l.some?.name?.in) {
        const wanted = l.some.name.in;
        if (![...issue.labels].some((lbl) => wanted.includes(lbl))) return false;
      }
      if (l.every?.name?.nin) {
        const banned = l.every.name.nin;
        if ([...issue.labels].some((lbl) => banned.includes(lbl))) return false;
      }
    }
    return true;
  }

  handle(body: { query: string; variables: Record<string, unknown> }): Response {
    const q = body.query;
    if (q.includes("issues(filter")) {
      const filter = body.variables.filter as Record<string, unknown>;
      const matches = [...this.issues.values()].filter((i) => this.matches(i, filter));
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: matches.map((i) => ({
                id: i.id,
                identifier: i.identifier,
                title: i.title,
                description: i.description,
                url: `https://linear.app/x/${i.identifier}`,
                priority: i.priority,
                createdAt: i.createdAt ?? "2026-01-01T00:00:00.000Z",
                state: i.state,
                assignee: null,
                labels: { nodes: [...i.labels].map((name) => ({ name })) },
                relations: { nodes: [] },
              })),
            },
          },
        }),
        { status: 200 },
      );
    }
    if (q.includes("commentCreate")) {
      this.comments.push({
        issueId: body.variables.issueId as string,
        body: body.variables.body as string,
      });
      return new Response(JSON.stringify({ data: { commentCreate: { success: true } } }));
    }
    if (q.includes("issueUpdate")) {
      const stateId = body.variables.stateId as string | undefined;
      const id = body.variables.id as string;
      const description = body.variables.description as string | undefined;
      const stateName = stateId
        ? [...this.stateIds.entries()].find(([, v]) => v === stateId)?.[0]
        : undefined;
      if (stateName) {
        const issue = this.issues.get(id);
        if (issue) issue.state = { name: stateName, type: "started" };
        this.statusMutations.push({ issueId: id, statusName: stateName });
      }
      if (description !== undefined) {
        const issue = this.issues.get(id);
        if (issue) issue.description = description;
        this.descriptionMutations.push({ issueId: id, description });
      }
      return new Response(JSON.stringify({ data: { issueUpdate: { success: true } } }));
    }
    if (q.includes("issueAddLabel")) {
      const id = body.variables.id as string;
      const labelId = body.variables.labelId as string;
      const labelName = [...this.labelIds.entries()].find(([, v]) => v === labelId)?.[0];
      if (labelName) {
        this.issues.get(id)?.labels.add(labelName);
        this.labelMutations.push({ issueId: id, op: "add", labelName });
      }
      return new Response(JSON.stringify({ data: { issueAddLabel: { success: true } } }));
    }
    if (q.includes("issueRemoveLabel")) {
      const id = body.variables.id as string;
      const labelId = body.variables.labelId as string;
      const labelName = [...this.labelIds.entries()].find(([, v]) => v === labelId)?.[0];
      if (labelName) {
        this.issues.get(id)?.labels.delete(labelName);
        this.labelMutations.push({ issueId: id, op: "remove", labelName });
      }
      return new Response(JSON.stringify({ data: { issueRemoveLabel: { success: true } } }));
    }
    if (q.includes("issueLabels")) {
      return new Response(
        JSON.stringify({
          data: {
            issueLabels: {
              nodes: [...this.labelIds.entries()].map(([name, id]) => ({
                id,
                name: name.includes(":") ? name.split(":")[1]! : name,
                parent: name.includes(":") ? { name: name.split(":")[0]! } : null,
              })),
            },
          },
        }),
      );
    }
    if (q.includes("workflowStates")) {
      return new Response(
        JSON.stringify({
          data: {
            workflowStates: {
              nodes: [...this.stateIds.entries()].map(([name, id]) => ({
                id,
                name,
                type: "unstarted",
              })),
            },
          },
        }),
      );
    }
    if (q.includes("issueLabelCreate")) {
      const name = (body.variables.name as string) ?? "";
      const newId = `label-created-${name}`;
      this.labelIds.set(name, newId);
      return new Response(
        JSON.stringify({
          data: { issueLabelCreate: { success: true, issueLabel: { id: newId } } },
        }),
      );
    }
    if (q.includes("TeamId") || (q.includes("teams") && q.includes("key"))) {
      return new Response(JSON.stringify({ data: { teams: { nodes: [{ id: "team-fake-id" }] } } }));
    }
    if (q.includes("IssueAttachments") || q.includes("attachments(first")) {
      return new Response(JSON.stringify({ data: { issue: { attachments: { nodes: [] } } } }));
    }
    if (q.includes("reactionCreate")) {
      this.reactions.push({
        commentId: body.variables.commentId as string,
        emoji: body.variables.emoji as string,
      });
      return new Response(JSON.stringify({ data: { reactionCreate: { success: true } } }));
    }
    if (q.includes("issue(id")) {
      const id = body.variables.id as string;
      const nodes = this.externalComments.get(id) ?? [];
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes } } } }));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
}

interface FakeWorker {
  resolve: (code: number) => void;
  cmd: string[];
}

interface MakeRunnersResult {
  runners: AgentRunners;
  workers: Map<string, FakeWorker>;
  setMergeable: (changeName: string, mergeable: "MERGEABLE" | "CONFLICTING") => void;
  setPrState: (changeName: string, state: "OPEN" | "MERGED" | "CLOSED") => void;
  setCiFailing: (changeName: string, failing: boolean) => void;
  ghCalls: string[][];
  gitCalls: string[][];
  spawnCalls: string[][];
}

function makeRunners(): MakeRunnersResult {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const prState = new Map<string, string>();
  const ciFailing = new Set<string>();
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];
  const spawnCalls: string[][] = [];

  const git: GitRunner = {
    run: async (args, _cwd) => {
      gitCalls.push(args);
      if (args[0] === "worktree" && args[1] === "list") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        const err = new Error("not found") as Error & { code?: number };
        err.code = 1;
        throw err;
      }
      return { stdout: "", stderr: "" };
    },
  };

  const cmd: CmdRunner = {
    run: async (cmdArr, _cwd) => {
      ghCalls.push(cmdArr);
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "view") {
        const url = cmdArr[3] ?? "";
        const tail = url.split("/").pop() ?? "";
        const findKey = (m: Map<string, string>): string | undefined => {
          if (m.has(tail)) return tail;
          for (const k of m.keys()) if (k.startsWith(tail)) return k;
          return undefined;
        };
        const sk = findKey(prState);
        const mk = findKey(mergeable);
        const payload = {
          state: (sk && prState.get(sk)) || "OPEN",
          mergeable: (mk && mergeable.get(mk)) || "MERGEABLE",
        };
        return { stdout: JSON.stringify(payload), stderr: "" };
      }
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "checks") {
        const url = cmdArr[3] ?? "";
        const tail = url.split("/").pop() ?? "";
        const findKey = (s: Set<string>): string | undefined => {
          if (s.has(tail)) return tail;
          for (const k of s) if (k.startsWith(tail)) return k;
          return undefined;
        };
        const hit = findKey(ciFailing);
        if (hit) {
          return {
            stdout: JSON.stringify([
              {
                name: "lint",
                bucket: "fail",
                link: "https://gh/owner/repo/actions/runs/12345/job/9876",
                workflow: "ci",
                event: "push",
              },
            ]),
            stderr: "",
          };
        }
        return { stdout: "[]", stderr: "" };
      }
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "list") {
        const searchIdx = cmdArr.indexOf("--search");
        const search = searchIdx >= 0 ? (cmdArr[searchIdx + 1] ?? "") : "";
        const identifier = search.split(" ")[0] ?? "";
        const slug = identifier.toLowerCase();
        let cn = "";
        for (const k of [...prState.keys(), ...mergeable.keys()]) {
          if (k.startsWith(slug)) {
            cn = k;
            break;
          }
        }
        if (!cn) cn = slug;
        return {
          stdout: JSON.stringify([
            {
              url: `https://gh/pr/${cn}`,
              state: "OPEN",
              headRefName: `ralph/${cn}`,
              title: `${identifier}: stub`,
              updatedAt: "2026-05-01T00:00:00Z",
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "", stderr: "" };
    },
  };

  const spawnWorker = (cmdArr: string[], _cwd: string) => {
    spawnCalls.push(cmdArr);
    let resolve!: (code: number) => void;
    const exited = new Promise<number>((r) => {
      resolve = r;
    });
    const idx = cmdArr.indexOf("--name");
    const key = idx >= 0 ? cmdArr[idx + 1]! : `worker-${workers.size}`;
    workers.set(key, { resolve, cmd: cmdArr });
    return { exited, kill: () => resolve(143) };
  };

  return {
    runners: { git, cmd, spawnWorker, runScript: async () => 0 },
    workers,
    setMergeable: (cn, m) => {
      mergeable.set(cn, m);
    },
    setPrState: (cn, s) => {
      prState.set(cn, s);
    },
    setCiFailing: (cn, failing) => {
      if (failing) ciFailing.add(cn);
      else ciFailing.delete(cn);
    },
    ghCalls,
    gitCalls,
    spawnCalls,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

// ---------------------------------------------------------------------------
// JSON event recorder
//
// Mirrors the event shape emitted by `apps/agent/src/agent/json-runner.ts`
// without requiring the runner itself: we install the same callbacks on
// `buildAgentCoordinator` and synthesise the `started` / `poll_start` /
// `poll_done` envelopes the runner adds. The recorder hands back a `wrap`
// helper that callers use around each `pollOnce()` so the captured stream
// matches what `--json-output` would have produced byte-for-byte (modulo
// the values rewritten by the normaliser in a later task).
// ---------------------------------------------------------------------------
interface JsonRecorderHandle {
  events: Record<string, unknown>[];
  callbacks: Pick<
    Parameters<typeof buildAgentCoordinator>[0],
    | "onLog"
    | "onWorkersChanged"
    | "onWorkerStarted"
    | "onWorkerExited"
    | "onWorkerPhase"
    | "onWorkerOutput"
    | "onWorkerCmd"
    | "onWorkerPr"
    | "onAwaitingTicket"
  >;
  emit: (event: Record<string, unknown>) => void;
  poll: <T extends { found: number; added: number; buckets: unknown; prStatus?: unknown }>(
    runPoll: () => Promise<T>,
  ) => Promise<T>;
}

const ANSI_STRIP_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/g;

function cleanOutputLine(raw: string): string | null {
  const clean = raw.replace(ANSI_STRIP_RE, "").trim();
  if (!clean) return null;
  return clean;
}

function createJsonRecorder(): JsonRecorderHandle {
  const events: Record<string, unknown>[] = [];
  const lastEmittedRoundByChange = new Map<string, number>();
  const emit = (event: Record<string, unknown>): void => {
    events.push({ ts: Date.now(), ...event });
  };

  const callbacks: JsonRecorderHandle["callbacks"] = {
    onLog: (text, color) => {
      const ev: Record<string, unknown> = { type: "log", text };
      if (color !== undefined) ev["color"] = color;
      emit(ev);
    },
    onWorkersChanged: () => {},
    onWorkerStarted: (changeName, dir, logFile, changeDir) => {
      emit({ type: "worker_started", changeName, statesDir: dir, logFile, changeDir });
    },
    onWorkerExited: (changeName) => {
      emit({ type: "worker_exited", changeName });
    },
    onWorkerPhase: (changeName, phase, detail) => {
      const ev: Record<string, unknown> = { type: "worker_phase", changeName, phase };
      if (detail !== undefined) ev["detail"] = detail;
      emit(ev);
    },
    onWorkerOutput: (changeName, line) => {
      const clean = cleanOutputLine(line);
      if (clean) emit({ type: "worker_output", changeName, line: clean });
    },
    onWorkerCmd: (changeName, cmd, state, durationMs, ok) => {
      if (state === "start") {
        emit({ type: "worker_cmd_start", changeName, cmd });
      } else {
        emit({
          type: "worker_cmd_end",
          changeName,
          cmd,
          durationMs: durationMs ?? 0,
          ok: ok ?? true,
        });
      }
    },
    onWorkerPr: (changeName, prUrl) => {
      emit({ type: "worker_pr", changeName, prUrl });
    },
    onAwaitingTicket: (info) => {
      const last = lastEmittedRoundByChange.get(info.changeName);
      if (last !== undefined && info.round <= last) return;
      lastEmittedRoundByChange.set(info.changeName, info.round);
      emit({
        type: "awaiting_confirmation",
        changeName: info.changeName,
        issueIdentifier: info.issueIdentifier,
        issueUrl: info.issueUrl,
        since: info.since,
        round: info.round,
      });
    },
  };

  const poll: JsonRecorderHandle["poll"] = async (runPoll) => {
    emit({ type: "poll_start" });
    const res = await runPoll();
    emit({
      type: "poll_done",
      found: res.found,
      added: res.added,
      buckets: res.buckets,
      prStatus: res.prStatus,
    });
    return res;
  };

  return { events, callbacks, emit, poll };
}

// ---------------------------------------------------------------------------
// Normaliser + golden-file helper
//
// The captured event stream contains values that vary across runs
// (timestamps, the per-test `tempDir`, durations, pids, random ids).
// Before diffing against a checked-in golden, `normalisePath` rewrites
// those volatile values to stable tokens so the file only changes when
// the contract itself changes. Inline unit tests live in the
// `describe("normalisePath", ...)` block below.
//
// When the JSON contract intentionally changes, re-record the golden:
//   UPDATE_GOLDEN=1 bun --cwd apps/agent test agent-characterization
// ---------------------------------------------------------------------------
const ISO_TS_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const TIMESTAMP_KEYS = new Set(["ts", "since", "started_at", "finished_at"]);
const DURATION_KEYS = new Set(["durationMs", "duration_ms", "elapsed_ms", "wall_ms", "cost_usd"]);
const PID_KEYS_ALL = new Set(["pid", "worker_pid"]);

// Leaf-level token replacement shared by the JSON-output and PostHog
// normalisers. Handles five classes of volatile values:
//   - timestamps (key-based + ISO-8601 substrings inside strings)
//   - tempDir paths (substring replacement)
//   - durations / wall-clock measurements (key-based)
//   - process ids (key-based)
//   - random ids (UUID substrings inside strings)
// Non-leaf values (arrays, objects) pass through unchanged; the calling
// recursive normaliser is responsible for descending into them.
function normalisePath(key: string, value: unknown, ctx: { tempDir: string }): unknown {
  if (TIMESTAMP_KEYS.has(key)) return "<TIMESTAMP>";
  if (DURATION_KEYS.has(key)) return "<DURATION>";
  if (PID_KEYS_ALL.has(key)) return "<PID>";
  if (typeof value === "string") {
    let s = value;
    if (ctx.tempDir) s = s.split(ctx.tempDir).join("<TMPDIR>");
    s = s.replace(ISO_TS_RE, "<TIMESTAMP>");
    s = s.replace(UUID_RE, "<UUID>");
    return s;
  }
  return value;
}

function normaliseEvent(
  event: Record<string, unknown>,
  ctx: { tempDir: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event)) {
    out[k] = normaliseValue(k, v, ctx);
  }
  return out;
}

function normaliseValue(key: string, value: unknown, ctx: { tempDir: string }): unknown {
  if (Array.isArray(value)) return value.map((v) => normaliseValue(key, v, ctx));
  if (value && typeof value === "object")
    return normaliseEvent(value as Record<string, unknown>, ctx);
  return normalisePath(key, value, ctx);
}

describe("normalisePath", () => {
  const ctx = { tempDir: "/tmp/ralph-xyz" };

  test("rewrites timestamp keys to <TIMESTAMP>", () => {
    expect(normalisePath("ts", 1234567890, ctx)).toBe("<TIMESTAMP>");
    expect(normalisePath("since", "anything", ctx)).toBe("<TIMESTAMP>");
    expect(normalisePath("started_at", "2026-01-01T00:00:00Z", ctx)).toBe("<TIMESTAMP>");
  });

  test("rewrites duration keys to <DURATION>", () => {
    expect(normalisePath("durationMs", 42, ctx)).toBe("<DURATION>");
    expect(normalisePath("duration_ms", 42, ctx)).toBe("<DURATION>");
    expect(normalisePath("wall_ms", 42, ctx)).toBe("<DURATION>");
    expect(normalisePath("cost_usd", 0.123, ctx)).toBe("<DURATION>");
  });

  test("rewrites pid keys to <PID>", () => {
    expect(normalisePath("pid", 12345, ctx)).toBe("<PID>");
    expect(normalisePath("worker_pid", 12345, ctx)).toBe("<PID>");
  });

  test("replaces tempDir substrings inside strings", () => {
    expect(normalisePath("path", "/tmp/ralph-xyz/foo/bar", ctx)).toBe("<TMPDIR>/foo/bar");
    expect(normalisePath("path", "leading /tmp/ralph-xyz/x", ctx)).toBe("leading <TMPDIR>/x");
  });

  test("replaces ISO-8601 timestamps inside strings", () => {
    expect(normalisePath("text", "at 2026-01-01T12:34:56.789Z done", ctx)).toBe(
      "at <TIMESTAMP> done",
    );
    expect(normalisePath("text", "no-fraction 2026-05-20T00:00:00Z", ctx)).toBe(
      "no-fraction <TIMESTAMP>",
    );
  });

  test("replaces UUIDs inside strings with <UUID>", () => {
    expect(normalisePath("text", "id=550e8400-e29b-41d4-a716-446655440000 ok", ctx)).toBe(
      "id=<UUID> ok",
    );
    // Non-UUID identifiers (e.g. test-fixture stubs) pass through.
    expect(normalisePath("text", "uuid-eng-1", ctx)).toBe("uuid-eng-1");
  });

  test("returns non-string scalars unchanged for non-special keys", () => {
    expect(normalisePath("found", 3, ctx)).toBe(3);
    expect(normalisePath("ok", true, ctx)).toBe(true);
    expect(normalisePath("ok", null, ctx)).toBe(null);
  });

  test("passes arrays and objects through (caller recurses)", () => {
    const arr = [1, 2];
    const obj = { a: 1 };
    expect(normalisePath("any", arr, ctx)).toBe(arr);
    expect(normalisePath("any", obj, ctx)).toBe(obj);
  });

  test("no-op when tempDir is empty", () => {
    expect(normalisePath("path", "/tmp/ralph-xyz/foo", { tempDir: "" })).toBe("/tmp/ralph-xyz/foo");
  });
});

async function assertOrUpdateGolden(
  goldenPath: string,
  events: Record<string, unknown>[],
  ctx: { tempDir: string },
): Promise<void> {
  const normalised = events.map((e) => normaliseEvent(e, ctx));
  const serialised = normalised.map((e) => JSON.stringify(e)).join("\n") + "\n";
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await Bun.write(goldenPath, serialised);
    return;
  }
  const file = Bun.file(goldenPath);
  if (!(await file.exists())) {
    throw new Error(
      `Golden file missing: ${goldenPath}. Re-record with: UPDATE_GOLDEN=1 bun test agent-characterization`,
    );
  }
  const expected = await file.text();
  expect(serialised).toBe(expected);
}

// ---------------------------------------------------------------------------
// PostHog telemetry recorder
//
// `mock.module("@ralphy/telemetry", ...)` at the top of the file pushes every
// `capture(event, properties)` call into the module-level `capturedTelemetry`
// array. `recordTelemetry()` returns a handle that snapshots the current
// length on creation, so scenarios can isolate the events emitted during
// their own poll calls without interference from previous scenarios sharing
// the same mocked module.
// ---------------------------------------------------------------------------
interface TelemetryRecorderHandle {
  events: () => CapturedTelemetry[];
}

function recordTelemetry(): TelemetryRecorderHandle {
  const startIdx = capturedTelemetry.length;
  return {
    events: () => capturedTelemetry.slice(startIdx),
  };
}

function normaliseTelemetryEvent(
  event: CapturedTelemetry,
  ctx: { tempDir: string; changeNames: Map<string, string> },
): Record<string, unknown> {
  const out: Record<string, unknown> = { event: event.event };
  if (event.properties === undefined) return out;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(event.properties)) {
    props[k] = normaliseTelemetryValue(k, v, ctx);
  }
  out["properties"] = props;
  return out;
}

function normaliseTelemetryValue(
  key: string,
  value: unknown,
  ctx: { tempDir: string; changeNames: Map<string, string> },
): unknown {
  if (Array.isArray(value)) return value.map((v) => normaliseTelemetryValue(key, v, ctx));
  if (value && typeof value === "object") {
    const inner: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      inner[k] = normaliseTelemetryValue(k, v, ctx);
    }
    return inner;
  }
  return normalisePath(key, value, ctx);
}

async function assertOrUpdateTelemetryGolden(
  goldenPath: string,
  events: CapturedTelemetry[],
  ctx: { tempDir: string; changeNames: Map<string, string> },
): Promise<void> {
  const normalised = events.map((e) => normaliseTelemetryEvent(e, ctx));
  const serialised = normalised.map((e) => JSON.stringify(e)).join("\n") + "\n";
  if (process.env["UPDATE_GOLDEN"] === "1") {
    await Bun.write(goldenPath, serialised);
    return;
  }
  const file = Bun.file(goldenPath);
  if (!(await file.exists())) {
    throw new Error(
      `Golden file missing: ${goldenPath}. Re-record with: UPDATE_GOLDEN=1 bun test agent-characterization`,
    );
  }
  const expected = await file.text();
  expect(serialised).toBe(expected);
}

const baseWorkflow = {
  concurrency: 1,
  useWorktree: false,
  createPrOnSuccess: false,
  linear: {
    team: "ENG",
    postComments: true,
    updateEveryIterations: 0,
    indicators: {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getConflicted: { filter: [{ type: "label", value: "ralph:conflicted" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
      setError: { type: "label", value: "ralph:error" },
      setConflicted: { type: "label", value: "ralph:conflicted" },
      clearConflicted: { type: "label", value: "ralph:conflicted" },
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("agent characterization — Stage-0 regression net", () => {
  test("scenario 1: new ticket → approval → implement → done (green)", async () => {
    // Stage-0 pin: today this collapses to a single fresh-mode spawn that
    // takes the ticket Todo → InProgress (on pickup) → Done (on clean
    // worker exit). No separate approval/implement step exists yet;
    // Stage-2 will split this into a gate + implement pair. The test
    // asserts the current observable contract.
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-eng-1",
      identifier: "ENG-1",
      title: "Add dark mode",
      description: "Users want dark mode",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls } = makeRunners();
    const recorder = createJsonRecorder();
    const telemetryRecorder = recordTelemetry();

    const { coord, filterDesc, concurrency, pollInterval } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      runners,
      ...recorder.callbacks,
    });

    // Emit the same `started` envelope `json-runner.ts` emits after init
    // so the captured stream is a faithful copy of `--json-output`.
    recorder.emit({
      type: "started",
      version: "<VERSION>",
      filterDesc,
      concurrency,
      pollInterval,
      configPath: "<CONFIG>",
    });

    await coord.init();

    // Poll 1: pickup, setInProgress, scaffold, spawn
    const poll1 = await recorder.poll(() => coord.pollOnce());
    expect(poll1.added).toBe(1);
    await tick();

    // State mutation: setInProgress applied on pickup
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "In Progress",
    });

    // tasks.md transition: change scaffolded on disk
    const changeName = "eng-1-add-dark-mode";
    expect(existsSync(join(tempDir, "openspec", "changes", changeName, "tasks.md"))).toBe(true);
    const proposal = readFileSync(
      join(tempDir, "openspec", "changes", changeName, "proposal.md"),
      "utf-8",
    );
    expect(proposal).toContain("ENG-1");
    expect(proposal).toContain("Users want dark mode");

    // Spawn mode contract: a single worker was spawned for this change
    // with the change name passed via `--name <changeName>`.
    expect(workers.has(changeName)).toBe(true);
    const spawnForChange = spawnCalls.find((c) => c.includes(changeName));
    expect(spawnForChange).toBeDefined();
    const nameIdx = spawnForChange!.indexOf("--name");
    expect(spawnForChange![nameIdx + 1]).toBe(changeName);

    // Started comment posted
    expect(linear.comments.some((c) => c.body.includes("Ralph started working"))).toBe(true);

    // Worker exits cleanly → setDone
    workers.get(changeName)!.resolve(0);
    await tick();

    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "Done",
    });
    expect(linear.comments.some((c) => c.body.includes("Ralph completed"))).toBe(true);
    expect(linear.issues.get("uuid-eng-1")!.state.name).toBe("Done");

    // No error label was applied along the happy path
    expect(linear.labelMutations.some((m) => m.labelName === "ralph:error")).toBe(false);

    // Re-poll: nothing to do (issue is Done, filter excludes it)
    const poll2 = await recorder.poll(() => coord.pollOnce());
    expect(poll2.added).toBe(0);

    // Single fresh-mode spawn for this issue across the entire flow
    const spawnsForChange = spawnCalls.filter((c) => c.includes(changeName));
    expect(spawnsForChange.length).toBe(1);

    // JSON-output recorder sanity checks: the canonical envelope events
    // (`started`, two `poll_start`/`poll_done` pairs, a `worker_started`
    // and a `worker_exited` for the change) all appear, in order. The
    // full normalised stream is diffed against the golden in a later task.
    const evTypes = recorder.events.map((e) => e.type);
    expect(evTypes[0]).toBe("started");
    expect(evTypes.filter((t) => t === "poll_start").length).toBe(2);
    expect(evTypes.filter((t) => t === "poll_done").length).toBe(2);
    expect(
      recorder.events.some((e) => e.type === "worker_started" && e.changeName === changeName),
    ).toBe(true);
    expect(
      recorder.events.some((e) => e.type === "worker_exited" && e.changeName === changeName),
    ).toBe(true);
    // worker_started precedes worker_exited.
    const startIdx = recorder.events.findIndex(
      (e) => e.type === "worker_started" && e.changeName === changeName,
    );
    const exitIdx = recorder.events.findIndex(
      (e) => e.type === "worker_exited" && e.changeName === changeName,
    );
    expect(startIdx).toBeLessThan(exitIdx);

    // Diff the full normalised event stream against the checked-in golden.
    // Re-record with `UPDATE_GOLDEN=1 bun test agent-characterization` when
    // the JSON event contract intentionally changes.
    await assertOrUpdateGolden(
      join(import.meta.dir, "__golden__", "json-output-new-ticket.jsonl"),
      recorder.events,
      { tempDir },
    );

    // PostHog telemetry contract: scenario 1 should emit at least the
    // `agent_worker_spawned` and `agent_worker_exited` capture()s. The full
    // normalised stream is diffed against the golden so a drift in event
    // shape (or a silent new emission) is flagged.
    const telemetryEvents = telemetryRecorder.events();
    const telemetryEventNames = telemetryEvents.map((e) => e.event);
    expect(telemetryEventNames).toContain("agent_worker_spawned");
    expect(telemetryEventNames).toContain("agent_worker_exited");
    await assertOrUpdateTelemetryGolden(
      join(import.meta.dir, "__golden__", "posthog-new-ticket.jsonl"),
      telemetryEvents,
      { tempDir, changeNames: new Map([[changeName, "<CHANGE_NAME>"]]) },
    );
  });

  test("scenario 2: new ticket → revise → design → approval → implement (green)", async () => {
    // Stage-0 pin: with confirmationMode enabled the existing
    // `classifyAwaitingConfirmation` path drives the revise loop.
    // Today's contract:
    //   • A `@ralphy revise: …` Linear comment causes the agent to
    //     restub `design.md` (and reduce `tasks.md` to a stub),
    //     append steering, react 👀 to the comment, bump
    //     `confirmation.rounds`, reap any in-flight worker, and
    //     leave the ticket in In Progress.
    //   • A subsequent approval (the `getApproved` indicator
    //     matching — here a `ralph:approved` label) clears the
    //     gate, fires `clearApproved`, and the next poll resumes
    //     the ticket with a `resume`-mode spawn.
    // Stage 2 will reshape these into named `design` and `implement`
    // spawn modes; the assertions below pin the observable effects
    // that must survive that refactor.
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");
    linear.labelIds.set("ralph:approved", "label-approved");

    const issue: FakeIssue = {
      id: "uuid-eng-2",
      identifier: "ENG-2",
      title: "Add light mode",
      description: "Users want light mode",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          optOutLabel: "ralph:auto-approve",
          timeoutHours: 48,
          maxConfirmationRounds: 3,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls } = makeRunners();
    const logs: string[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text) => logs.push(text),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });

    await coord.init();

    const changeName = "eng-2-add-light-mode";
    const changeDir = join(tempDir, "openspec", "changes", changeName);
    const designPath = join(changeDir, "design.md");
    const tasksPath = join(changeDir, "tasks.md");

    // Poll 1: Todo pickup → fresh-mode spawn, design.md is a stub so
    // the deriver is in `design`, NOT `awaiting-confirmation` yet.
    const poll1 = await coord.pollOnce();
    expect(poll1.added).toBe(1);
    await tick();
    expect(workers.has(changeName)).toBe(true);
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-2",
      statusName: "In Progress",
    });

    // Simulate the worker finishing planning: fill in design.md so the
    // OpenSpec deriver moves the ticket into `awaiting-confirmation`
    // on the next poll.
    await Bun.write(
      designPath,
      [
        `# Design for ${changeName}`,
        "",
        "## Approach",
        "",
        "We will add a light theme toggle to settings.",
        "",
      ].join("\n"),
    );

    // Poll 2: ticket flips to awaiting-confirmation. Worker reaped,
    // plan-ready Linear comment posted exactly once.
    await coord.pollOnce();
    await tick();
    expect(linear.comments.some((c) => c.body.includes("Ralphy plan ready"))).toBe(true);
    const planReadyCount = linear.comments.filter((c) =>
      c.body.includes("Ralphy plan ready"),
    ).length;
    expect(planReadyCount).toBe(1);
    // Worker for the change is gone (reaped).
    expect(coord.activeWorkers.some((w) => w.changeName === changeName)).toBe(false);
    // Spawn count after reap is still 1 (no resume issued yet).
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBe(1);

    // Inject a revise comment. The poll's confirmation scan will see
    // it (createdAt > askedAt) and trigger the revise branch.
    linear.addExternalComment("uuid-eng-2", {
      id: "revise-1",
      body: "@ralphy revise: please reconsider the toggle placement",
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Poll 3: revise consumed → design.md restubbed, tasks.md stubbed,
    // 👀 reaction recorded, rounds bumped, plan-ready NOT reposted.
    await coord.pollOnce();
    await tick();
    const designAfterRevise = readFileSync(designPath, "utf-8");
    expect(designAfterRevise).toContain(`# Design for ${changeName}`);
    expect(designAfterRevise).toContain("_Fill in the technical design");
    const tasksAfterRevise = readFileSync(tasksPath, "utf-8");
    expect(tasksAfterRevise).toContain("Regenerating after revise request");
    expect(linear.reactions).toContainEqual({ commentId: "revise-1", emoji: "👀" });
    // Plan-ready comment still posted exactly once across both polls.
    expect(linear.comments.filter((c) => c.body.includes("Ralphy plan ready")).length).toBe(1);

    // Confirmation state on disk reflects rounds=1 and a non-null
    // lastReviseConsumedAt watermark so a duplicate revise comment
    // wouldn't be re-consumed.
    const statePath = join(tempDir, ".ralph", "tasks", changeName, ".ralph-state.json");
    const stateAfterRevise = JSON.parse(readFileSync(statePath, "utf-8")) as {
      confirmation?: { rounds?: number; lastReviseConsumedAt?: string | null };
    };
    expect(stateAfterRevise.confirmation?.rounds).toBe(1);
    expect(stateAfterRevise.confirmation?.lastReviseConsumedAt).not.toBeNull();

    // Simulate the worker re-completing planning after revise: refill
    // design.md so the deriver re-gates.
    await Bun.write(
      designPath,
      [
        `# Design for ${changeName}`,
        "",
        "## Approach (v2)",
        "",
        "Refined approach addressing the reviewer's note.",
        "",
      ].join("\n"),
    );
    // tasks.md was stubbed by restartFromDesign — re-populate with
    // unchecked items so the deriver can re-enter awaiting-confirmation
    // (and later, implement).
    await Bun.write(
      tasksPath,
      [`# Tasks for ${changeName}`, "", "## Implementation", "", "- [ ] Implement toggle", ""].join(
        "\n",
      ),
    );

    // Approval arrives — label flips on. The next poll re-gates and
    // observes approvalMatches=true, fires clearApproved, persists
    // confirmedAt, drops the ticket from the awaiting set.
    issue.labels.add("ralph:approved");

    const poll4 = await coord.pollOnce();
    await tick();
    // clearApproved fired (label removed).
    expect(linear.labelMutations).toContainEqual({
      issueId: "uuid-eng-2",
      op: "remove",
      labelName: "ralph:approved",
    });
    // Awaiting count is back to zero on this poll.
    expect(poll4.buckets.awaiting).toBe(0);

    // Implement: the ticket is now in inProgress (still has the
    // In Progress status) and falls through the resume path → a
    // resume-mode spawn issues.
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBeGreaterThanOrEqual(2);
    expect(workers.has(changeName)).toBe(true);

    // Worker exits cleanly → Done.
    workers.get(changeName)!.resolve(0);
    await tick();
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-2",
      statusName: "Done",
    });
    expect(linear.issues.get("uuid-eng-2")!.state.name).toBe("Done");

    // No error label along the revise→approval path.
    expect(linear.labelMutations.some((m) => m.op === "add" && m.labelName === "ralph:error")).toBe(
      false,
    );
  });

  // Scenario 3 (test.failing): Stage-2-correct behavior is that a CONFLICTING
  // PR for a gated ticket (awaiting confirmation) preempts the gate — a
  // conflict-fix spawn runs and the `ralph:conflicted` label is applied
  // BEFORE the user is asked to re-approve. Today the gate wins: the
  // ticket sits in awaiting-confirmation, no conflict-fix work is queued,
  // and the conflict goes unaddressed until approval lands. Flipping
  // `test.failing` → `test` after Stage 2's coordinator refactor is the
  // only edit needed.
  test.failing(
    "scenario 3: gated ticket + PR conflicted → conflict-fix wins (test.failing)",
    async () => {
      const linear = new FakeLinear();
      linear.stateIds.set("Todo", "state-todo");
      linear.stateIds.set("In Progress", "state-inprogress");
      linear.stateIds.set("Done", "state-done");
      linear.labelIds.set("ralph:conflicted", "label-conf");
      linear.labelIds.set("ralph:error", "label-err");
      linear.labelIds.set("ralph:approved", "label-approved");

      const issue: FakeIssue = {
        id: "uuid-eng-3",
        identifier: "ENG-3",
        title: "Add toolbar",
        description: "Users want a toolbar",
        state: { name: "Todo", type: "unstarted" },
        labels: new Set(),
        priority: 3,
      };
      linear.add(issue);

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.includes("linear.app")) {
          throw new Error("unexpected fetch in test");
        }
        const body = JSON.parse(init?.body as string) as {
          query: string;
          variables: Record<string, unknown>;
        };
        return linear.handle(body);
      }) as typeof fetch;

      const confirmationWorkflow = {
        ...baseWorkflow,
        linear: {
          ...baseWorkflow.linear,
          confirmationMode: {
            enabled: true,
            optOutLabel: "ralph:auto-approve",
            timeoutHours: 48,
            maxConfirmationRounds: 3,
          },
          indicators: {
            ...baseWorkflow.linear.indicators,
            getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
            getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
            clearApproved: { type: "label", value: "ralph:approved" },
          },
        },
      };
      await writeWorkflow(tempDir, confirmationWorkflow);
      const cfg = await loadRalphyConfig(tempDir);
      const args = await parseArgs([]);

      const { runners, workers, spawnCalls, setMergeable } = makeRunners();
      const logs: string[] = [];

      const { coord } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot: tempDir,
        statesDir: join(tempDir, ".ralph", "tasks"),
        tasksDir: join(tempDir, "openspec", "changes"),
        apiKey: "fake-key",
        onLog: (text) => logs.push(text),
        onWorkersChanged: () => {},
        onWorkerStarted: () => {},
        onWorkerExited: () => {},
        runners,
      });

      await coord.init();

      const changeName = "eng-3-add-toolbar";
      const changeDir = join(tempDir, "openspec", "changes", changeName);
      const designPath = join(changeDir, "design.md");
      const tasksPath = join(changeDir, "tasks.md");

      // Poll 1: fresh spawn.
      await coord.pollOnce();
      await tick();
      expect(workers.has(changeName)).toBe(true);

      // Fill design.md so the next poll moves into awaiting-confirmation.
      await Bun.write(
        designPath,
        [`# Design for ${changeName}`, "", "## Approach", "", "Add a toolbar component.", ""].join(
          "\n",
        ),
      );

      // Poll 2: gate fires — plan-ready posted, worker reaped.
      await coord.pollOnce();
      await tick();
      expect(linear.comments.some((c) => c.body.includes("Ralphy plan ready"))).toBe(true);

      // The PR for the change now goes CONFLICTING while the ticket is
      // still gated awaiting approval.
      setMergeable(changeName, "CONFLICTING");

      const spawnsBeforeConflict = spawnCalls.filter((c) => c.includes(changeName)).length;

      // Poll 3: Stage-2-correct — conflict-fix preempts the gate.
      await coord.pollOnce();
      await tick();

      // setConflicted label was applied (conflict-fix path engaged).
      expect(
        linear.labelMutations.some(
          (m) => m.op === "add" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-3",
        ),
      ).toBe(true);

      // A conflict-fix worker was spawned (one more spawn than before the
      // conflict was introduced).
      const spawnsAfterConflict = spawnCalls.filter((c) => c.includes(changeName)).length;
      expect(spawnsAfterConflict).toBeGreaterThan(spawnsBeforeConflict);

      // tasks.md was prepended with the conflict-fix instructions — this
      // is how conflict-fix mode communicates the work to the worker.
      const tasksAfterConflict = readFileSync(tasksPath, "utf-8");
      expect(tasksAfterConflict).toContain("Resolve PR merge conflicts");

      // The gate did NOT post a duplicate plan-ready while the conflict
      // was being addressed.
      const planReadyCount = linear.comments.filter((c) =>
        c.body.includes("Ralphy plan ready"),
      ).length;
      expect(planReadyCount).toBe(1);
    },
  );

  // Scenario 4 (test.failing): Stage-2-correct behavior is that a CI-failing
  // PR for a gated ticket (awaiting confirmation) preempts the gate — a
  // ci-fix spawn runs to address the failing checks BEFORE the user is
  // asked to re-approve. Today the gate wins: `ci_failed` is only counted
  // in the scan bucket (`counts.ciFailed`) and no remediation work is
  // queued — the coordinator only acts on `conflicted` PRs. Flipping
  // `test.failing` → `test` after Stage 2's coordinator refactor is the
  // only edit needed.
  test.failing("scenario 4: gated ticket + CI failing → ci-fix wins (test.failing)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");
    linear.labelIds.set("ralph:approved", "label-approved");
    linear.labelIds.set("ralph:ci-failed", "label-ci-failed");

    const issue: FakeIssue = {
      id: "uuid-eng-4",
      identifier: "ENG-4",
      title: "Add status bar",
      description: "Users want a status bar",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          optOutLabel: "ralph:auto-approve",
          timeoutHours: 48,
          maxConfirmationRounds: 3,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
          setCiFailed: { type: "label", value: "ralph:ci-failed" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setCiFailing } = makeRunners();
    const logs: string[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text) => logs.push(text),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });

    await coord.init();

    const changeName = "eng-4-add-status-bar";
    const changeDir = join(tempDir, "openspec", "changes", changeName);
    const designPath = join(changeDir, "design.md");
    const tasksPath = join(changeDir, "tasks.md");

    // Poll 1: fresh spawn.
    await coord.pollOnce();
    await tick();
    expect(workers.has(changeName)).toBe(true);

    // Fill design.md so the next poll moves into awaiting-confirmation.
    await Bun.write(
      designPath,
      [`# Design for ${changeName}`, "", "## Approach", "", "Add a status bar.", ""].join("\n"),
    );

    // Poll 2: gate fires — plan-ready posted, worker reaped.
    await coord.pollOnce();
    await tick();
    expect(linear.comments.some((c) => c.body.includes("Ralphy plan ready"))).toBe(true);

    // The PR for the change now has FAILING CI while the ticket is
    // still gated awaiting approval.
    setCiFailing(changeName, true);

    const spawnsBeforeCi = spawnCalls.filter((c) => c.includes(changeName)).length;

    // Poll 3: Stage-2-correct — ci-fix preempts the gate.
    await coord.pollOnce();
    await tick();

    // setCiFailed label was applied (ci-fix path engaged).
    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:ci-failed" && m.issueId === "uuid-eng-4",
      ),
    ).toBe(true);

    // A ci-fix worker was spawned (one more spawn than before the CI
    // failure was introduced).
    const spawnsAfterCi = spawnCalls.filter((c) => c.includes(changeName)).length;
    expect(spawnsAfterCi).toBeGreaterThan(spawnsBeforeCi);

    // tasks.md was prepended with the ci-fix instructions — this is how
    // ci-fix mode communicates the failing-checks context to the worker.
    const tasksAfterCi = readFileSync(tasksPath, "utf-8");
    expect(tasksAfterCi).toContain("CI is failing");

    // The gate did NOT post a duplicate plan-ready while CI was being
    // addressed.
    const planReadyCount = linear.comments.filter((c) =>
      c.body.includes("Ralphy plan ready"),
    ).length;
    expect(planReadyCount).toBe(1);
  });

  // Scenario 5 (test.failing): Stage-2-correct behavior is that once a user
  // has approved a ticket, the `ralph:approved` label AND the persisted
  // approval state survive a subsequent conflict-fix reset — the user is
  // NOT asked to re-approve and the audit trail (the label on the issue)
  // remains intact. Today the coordinator fires `clearApproved` eagerly
  // the first time it observes the approval label (wire.ts ~L2039),
  // stripping the label from Linear immediately. The persisted
  // `confirmation.confirmedAt` watermark then carries the approval
  // forward in state, but the label-on-issue evidence is gone — so an
  // observer (or a downstream system reading Linear) cannot tell the
  // ticket was ever approved once conflict-fix resets it. Flipping
  // `test.failing` → `test` after Stage 2 stops the eager clear is the
  // only edit needed.
  test.failing(
    "scenario 5: approval persisted + tasks reset for conflict-fix → no re-gate (test.failing)",
    async () => {
      const linear = new FakeLinear();
      linear.stateIds.set("Todo", "state-todo");
      linear.stateIds.set("In Progress", "state-inprogress");
      linear.stateIds.set("Done", "state-done");
      linear.labelIds.set("ralph:conflicted", "label-conf");
      linear.labelIds.set("ralph:error", "label-err");
      linear.labelIds.set("ralph:approved", "label-approved");

      const issue: FakeIssue = {
        id: "uuid-eng-5",
        identifier: "ENG-5",
        title: "Add sidebar",
        description: "Users want a sidebar",
        state: { name: "Todo", type: "unstarted" },
        labels: new Set(),
        priority: 3,
      };
      linear.add(issue);

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.includes("linear.app")) {
          throw new Error("unexpected fetch in test");
        }
        const body = JSON.parse(init?.body as string) as {
          query: string;
          variables: Record<string, unknown>;
        };
        return linear.handle(body);
      }) as typeof fetch;

      const confirmationWorkflow = {
        ...baseWorkflow,
        linear: {
          ...baseWorkflow.linear,
          confirmationMode: {
            enabled: true,
            optOutLabel: "ralph:auto-approve",
            timeoutHours: 48,
            maxConfirmationRounds: 3,
          },
          indicators: {
            ...baseWorkflow.linear.indicators,
            getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
            getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
            clearApproved: { type: "label", value: "ralph:approved" },
          },
        },
      };
      await writeWorkflow(tempDir, confirmationWorkflow);
      const cfg = await loadRalphyConfig(tempDir);
      const args = await parseArgs([]);

      const { runners, workers, spawnCalls, setMergeable } = makeRunners();
      const logs: string[] = [];

      const { coord } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot: tempDir,
        statesDir: join(tempDir, ".ralph", "tasks"),
        tasksDir: join(tempDir, "openspec", "changes"),
        apiKey: "fake-key",
        onLog: (text) => logs.push(text),
        onWorkersChanged: () => {},
        onWorkerStarted: () => {},
        onWorkerExited: () => {},
        runners,
      });

      await coord.init();

      const changeName = "eng-5-add-sidebar";
      const changeDir = join(tempDir, "openspec", "changes", changeName);
      const designPath = join(changeDir, "design.md");
      const tasksPath = join(changeDir, "tasks.md");

      // Poll 1: fresh spawn.
      await coord.pollOnce();
      await tick();
      expect(workers.has(changeName)).toBe(true);

      // Fill design.md so the next poll moves into awaiting-confirmation.
      await Bun.write(
        designPath,
        [`# Design for ${changeName}`, "", "## Approach", "", "Add a sidebar.", ""].join("\n"),
      );

      // Poll 2: gate fires — plan-ready posted, worker reaped.
      await coord.pollOnce();
      await tick();
      expect(linear.comments.some((c) => c.body.includes("Ralphy plan ready"))).toBe(true);

      // Populate tasks.md with unchecked implementation items so the
      // post-approval phase resolves to `implement` rather than `done`.
      await Bun.write(
        tasksPath,
        [
          `# Tasks for ${changeName}`,
          "",
          "## Implementation",
          "",
          "- [ ] Implement sidebar",
          "",
        ].join("\n"),
      );

      // Approval arrives — label flips on.
      issue.labels.add("ralph:approved");

      // Poll 3: gate clears, approval persisted, resume spawn issues.
      await coord.pollOnce();
      await tick();
      expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBeGreaterThanOrEqual(2);

      // The PR for the change now goes CONFLICTING while the ticket is
      // mid-implement.
      setMergeable(changeName, "CONFLICTING");

      // Poll 4: conflict-fix path engages — tasks.md is prepended with
      // the conflict-fix instructions, conflict-fix worker spawns.
      await coord.pollOnce();
      await tick();
      const tasksAfterConflict = readFileSync(tasksPath, "utf-8");
      expect(tasksAfterConflict).toContain("Resolve PR merge conflicts");

      // Stage-2-correct assertion 1: the `ralph:approved` label is STILL
      // on the issue (preserved across the conflict-fix reset). Today
      // this fails because `clearApproved` was fired on poll 3 — the
      // label was stripped immediately on approval and never restored.
      expect(linear.issues.get("uuid-eng-5")!.labels.has("ralph:approved")).toBe(true);

      // Stage-2-correct assertion 2: no `clearApproved` remove mutation
      // was issued for this issue. Today this fails for the same reason.
      expect(
        linear.labelMutations.some(
          (m) =>
            m.op === "remove" && m.labelName === "ralph:approved" && m.issueId === "uuid-eng-5",
        ),
      ).toBe(false);

      // Stage-2-correct assertion 3: persisted approval watermark
      // survives the conflict-fix tasks.md reset. The state file's
      // `confirmation.confirmedAt` must remain a non-null ISO string.
      const statePath = join(tempDir, ".ralph", "tasks", changeName, ".ralph-state.json");
      const stateAfterConflict = JSON.parse(readFileSync(statePath, "utf-8")) as {
        confirmation?: { confirmedAt?: string | null };
      };
      expect(stateAfterConflict.confirmation?.confirmedAt).not.toBeNull();
      expect(typeof stateAfterConflict.confirmation?.confirmedAt).toBe("string");

      // Stage-2-correct assertion 4: no re-gate. Plan-ready was posted
      // exactly once — the user is NOT asked to re-approve after the
      // conflict-fix reset.
      const planReadyCount = linear.comments.filter((c) =>
        c.body.includes("Ralphy plan ready"),
      ).length;
      expect(planReadyCount).toBe(1);
    },
  );

  // Scenario 6: round-cap exhaustion → stuck. Driving `maxConfirmationRounds`
  // consecutive revise rounds (each loop is a worker iteration that ends in
  // an `@ralphy revise: …` reviewer comment instead of approval) exhausts
  // the cap. On the next poll the gate sees `rounds >= cap` and fires the
  // stuck path — applying the `ralph:stuck` label, posting the stuck
  // comment, AND issuing no further spawn for the change on that poll. The
  // ticket stays in awaiting (no implement work fires while stuck).
  test("scenario 6: round-cap exhaustion → stuck (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");
    linear.labelIds.set("ralph:approved", "label-approved");
    linear.labelIds.set("ralph:stuck", "label-stuck");

    const issue: FakeIssue = {
      id: "uuid-eng-6",
      identifier: "ENG-6",
      title: "Add notifications",
      description: "Users want notifications",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    const confirmationWorkflow = {
      ...baseWorkflow,
      linear: {
        ...baseWorkflow.linear,
        confirmationMode: {
          enabled: true,
          optOutLabel: "ralph:auto-approve",
          timeoutHours: 48,
          // Small cap so two revise rounds are enough to exhaust it.
          maxConfirmationRounds: 2,
        },
        indicators: {
          ...baseWorkflow.linear.indicators,
          getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
          getApproved: { filter: [{ type: "label", value: "ralph:approved" }] },
          clearApproved: { type: "label", value: "ralph:approved" },
        },
      },
    };
    await writeWorkflow(tempDir, confirmationWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls } = makeRunners();
    const logs: string[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text) => logs.push(text),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });

    await coord.init();

    const changeName = "eng-6-add-notifications";
    const changeDir = join(tempDir, "openspec", "changes", changeName);
    const designPath = join(changeDir, "design.md");
    const tasksPath = join(changeDir, "tasks.md");

    // The deriver only returns `awaiting-confirmation` when design.md is
    // filled AND tasks.md has at least one unchecked `- [ ]` item. Each
    // revise round re-stubs both, so the test must repopulate both before
    // the next gate fires.
    const fillDesign = async (variant: string): Promise<void> => {
      await Bun.write(
        designPath,
        [`# Design for ${changeName}`, "", `## Approach (${variant})`, "", "Plan body.", ""].join(
          "\n",
        ),
      );
      await Bun.write(
        tasksPath,
        [
          `# Tasks for ${changeName}`,
          "",
          "## Implementation",
          "",
          "- [ ] Implement notifications",
          "",
        ].join("\n"),
      );
    };

    // Poll 1: Todo pickup → fresh-mode spawn.
    await coord.pollOnce();
    await tick();
    expect(workers.has(changeName)).toBe(true);
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBe(1);

    // Fill design → Poll 2 will gate.
    await fillDesign("v1");

    // Poll 2: gate fires (rounds=0), plan-ready posted, worker reaped.
    await coord.pollOnce();
    await tick();
    expect(linear.comments.some((c) => c.body.includes("Ralphy plan ready"))).toBe(true);

    // Inject revise #1 (createdAt strictly after the askedAt watermark).
    linear.addExternalComment("uuid-eng-6", {
      id: "revise-1",
      body: "@ralphy revise: reconsider the API surface",
      createdAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // Poll 3: revise consumed → rounds=1, design restubbed.
    await coord.pollOnce();
    await tick();
    const statePath = join(tempDir, ".ralph", "tasks", changeName, ".ralph-state.json");
    const stateAfterRevise1 = JSON.parse(readFileSync(statePath, "utf-8")) as {
      confirmation?: { rounds?: number };
    };
    expect(stateAfterRevise1.confirmation?.rounds).toBe(1);

    // Worker re-fills design for round 2.
    await fillDesign("v2");

    // Poll 4: gate fires again (rounds=1).
    await coord.pollOnce();
    await tick();

    // Inject revise #2 (newer than the previous lastReviseConsumedAt).
    linear.addExternalComment("uuid-eng-6", {
      id: "revise-2",
      body: "@ralphy revise: still not right",
      createdAt: new Date(Date.now() + 120_000).toISOString(),
    });

    // Poll 5: revise consumed → rounds=2 (== cap), design restubbed.
    await coord.pollOnce();
    await tick();
    const stateAfterRevise2 = JSON.parse(readFileSync(statePath, "utf-8")) as {
      confirmation?: { rounds?: number };
    };
    expect(stateAfterRevise2.confirmation?.rounds).toBe(2);

    // Worker re-fills design — but the next poll's gate will trip the cap
    // BEFORE any revise/approval logic runs.
    await fillDesign("v3");

    const spawnsBeforeStuck = spawnCalls.filter((c) => c.includes(changeName)).length;

    // Poll 6: round-cap exhaustion — rounds >= cap → stuck.
    await coord.pollOnce();
    await tick();

    // `ralph:stuck` label was applied to the issue.
    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:stuck" && m.issueId === "uuid-eng-6",
      ),
    ).toBe(true);
    expect(linear.issues.get("uuid-eng-6")!.labels.has("ralph:stuck")).toBe(true);

    // Stuck comment was posted on the issue.
    expect(linear.comments.some((c) => c.body.includes("confirmation gate stuck"))).toBe(true);

    // `stuckPostedAt` watermark persisted so subsequent polls don't re-post.
    const stateAfterStuck = JSON.parse(readFileSync(statePath, "utf-8")) as {
      confirmation?: { stuckPostedAt?: string | null };
    };
    expect(stateAfterStuck.confirmation?.stuckPostedAt).not.toBeNull();
    expect(typeof stateAfterStuck.confirmation?.stuckPostedAt).toBe("string");

    // No new spawn was issued on this poll — the ticket is parked, no
    // implement / resume / revise worker fires while stuck.
    const spawnsAfterStuck = spawnCalls.filter((c) => c.includes(changeName)).length;
    expect(spawnsAfterStuck).toBe(spawnsBeforeStuck);

    // A subsequent poll while still stuck does NOT repost the stuck comment
    // (idempotency via stuckPostedAt) and STILL issues no spawn.
    const commentsBeforeRepoll = linear.comments.length;
    const spawnsBeforeRepoll = spawnCalls.filter((c) => c.includes(changeName)).length;
    await coord.pollOnce();
    await tick();
    expect(linear.comments.filter((c) => c.body.includes("confirmation gate stuck")).length).toBe(
      1,
    );
    expect(linear.comments.length).toBe(commentsBeforeRepoll);
    expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBe(spawnsBeforeRepoll);
  });

  // Scenario 7: finished + PR conflicting → conflict-fix (green). A ticket that
  // has been driven all the way to Done by Ralph still has a live PR. If main
  // moves forward and the PR goes CONFLICTING, the next poll's conflict-scan
  // promotes the change back into the active set: applies the `ralph:conflicted`
  // label, posts a merge-conflicts comment, and spawns a conflict-fix worker.
  // On clean exit, `clearConflicted` fires and `setDone` is NOT re-applied
  // (the ticket is already Done — the conflict-fix path skips status updates).
  // This is the anchor for RLF-81's "promote finished-with-conflicts back to
  // active" behavior; Stage 2 will layer on richer telemetry, but the
  // observable Linear-side contract pinned here must not regress.
  test("scenario 7: finished + PR conflicting → conflict-fix (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:conflicted", "label-conf");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-eng-7",
      identifier: "ENG-7",
      title: "Add footer",
      description: "Users want a footer",
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("linear.app")) {
        throw new Error("unexpected fetch in test");
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setMergeable } = makeRunners();
    const logs: string[] = [];

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: (text) => logs.push(text),
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });

    await coord.init();

    const changeName = "eng-7-add-footer";

    // Poll 1: fresh-mode spawn, ticket → In Progress.
    await coord.pollOnce();
    await tick();
    expect(workers.has(changeName)).toBe(true);

    // Worker exits cleanly → setDone, ticket is now finished.
    workers.get(changeName)!.resolve(0);
    await tick();
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-7",
      statusName: "Done",
    });
    expect(linear.issues.get("uuid-eng-7")!.state.name).toBe("Done");
    const doneCountBeforeConflict = linear.statusMutations.filter(
      (s) => s.statusName === "Done",
    ).length;
    expect(doneCountBeforeConflict).toBe(1);

    // Re-poll while clean: nothing to do (ticket is Done, PR mergeable).
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);

    // Main moves forward → PR for the (already Done) ticket goes CONFLICTING.
    setMergeable(changeName, "CONFLICTING");

    const spawnsBeforePromotion = spawnCalls.filter((c) => c.includes(changeName)).length;

    // Poll 3: conflict-scan promotes the finished ticket back into active —
    // setConflicted label applied, merge-conflicts comment posted, conflict-fix
    // worker spawned. This is the RLF-81 promotion anchor.
    await coord.pollOnce();
    await tick();

    // setConflicted label applied (the audit-trail / promotion signal).
    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-7",
      ),
    ).toBe(true);
    expect(linear.issues.get("uuid-eng-7")!.labels.has("ralph:conflicted")).toBe(true);

    // Conflict-promotion comment posted on the issue. Today's contract uses
    // the phrase "merge conflicts" in the body; pinning the substring keeps
    // the assertion robust to copy tweaks while still catching a regression
    // that drops the comment entirely.
    expect(linear.comments.some((c) => c.body.includes("merge conflicts"))).toBe(true);

    // A conflict-fix worker was spawned for this change.
    const spawnsAfterPromotion = spawnCalls.filter((c) => c.includes(changeName)).length;
    expect(spawnsAfterPromotion).toBeGreaterThan(spawnsBeforePromotion);
    const fixWorker = workers.get(changeName);
    expect(fixWorker).toBeDefined();

    // Today's contract: the conflict-fix promotion re-applies `setInProgress`
    // when re-engaging a finished ticket — the ticket is back in the active
    // bucket for the duration of the conflict-fix worker. This pins the
    // current observable: the lifecycle status flips back to In Progress.
    expect(linear.issues.get("uuid-eng-7")!.state.name).toBe("In Progress");
    expect(
      linear.statusMutations.filter(
        (s) => s.statusName === "In Progress" && s.issueId === "uuid-eng-7",
      ).length,
    ).toBeGreaterThanOrEqual(2);

    // Conflict-fix worker exits cleanly → clearConflicted fires, no second
    // setDone is issued (the ticket is already Done; conflict-fix is a
    // PR-level fixup, not a fresh lifecycle run).
    fixWorker!.resolve(0);
    await tick();

    expect(
      linear.labelMutations.some(
        (m) =>
          m.op === "remove" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-7",
      ),
    ).toBe(true);
    const doneCountAfterFix = linear.statusMutations.filter((s) => s.statusName === "Done").length;
    expect(doneCountAfterFix).toBe(1);
  });
});
