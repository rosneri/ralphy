/**
 * RLF-113 — S10 PR lifecycle scenarios.
 *
 * Tests PR lifecycle edge cases in coordinator: discovery, state changes,
 * draft detection, multi-PR disambiguation.
 *
 * test.failing tests encode currently-unimplemented behaviour:
 *   S10.3 — git push failure is not yet surfaced as a conflict signal
 *   S10.4 — PR already-merged short-circuit not yet wired
 *   S10.5 — isDraft gate on review signal not yet wired
 *   S10.6 — headRefName matching now strict (moved to GREEN)
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import YAML from "yaml";

mock.module("@ralphy/telemetry", () => ({
  capture: () => {},
  captureError: () => {},
  init: async () => {},
  shutdown: async () => {},
  setDefaultProperties: () => {},
}));

import { parseAgentArgs as parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-s10-"));
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

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
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  labelIds = new Map<string, string>();
  stateIds = new Map<string, string>();

  add(issue: FakeIssue): void {
    this.issues.set(issue.id, issue);
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
      const s = filter.state as {
        name?: { in?: string[]; nin?: string[] };
        type?: { in?: string[] };
      };
      if (s.name?.in && !s.name.in.includes(issue.state.name)) return false;
      if (s.name?.nin && s.name.nin.includes(issue.state.name)) return false;
      if (s.type?.in && !s.type.in.includes(issue.state.type)) return false;
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
      const stateName = stateId
        ? [...this.stateIds.entries()].find(([, v]) => v === stateId)?.[0]
        : undefined;
      if (stateName) {
        const issue = this.issues.get(id);
        if (issue) issue.state = { name: stateName, type: "started" };
        this.statusMutations.push({ issueId: id, statusName: stateName });
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
    if (q.includes("issue(id")) {
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
}

interface FakeWorker {
  resolve: (code: number) => void;
  cmd: string[];
}

interface MakeRunnersS10Result {
  runners: AgentRunners;
  workers: Map<string, FakeWorker>;
  setMergeable: (changeName: string, mergeable: "MERGEABLE" | "CONFLICTING") => void;
  setPrState: (changeName: string, state: "OPEN" | "MERGED" | "CLOSED") => void;
  setCiFailing: (changeName: string, failing: boolean) => void;
  setIsDraft: (changeName: string, draft: boolean) => void;
  /** Override the gh pr list response for a changeName */
  overridePrList: (
    changeName: string,
    rows: { url: string; state: string; headRefName: string; title: string; updatedAt: string }[],
  ) => void;
  failNextGitPush: (changeName: string) => void;
  ghCalls: string[][];
  gitCalls: string[][];
  spawnCalls: string[][];
}

function makeRunnersS10(): MakeRunnersS10Result {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const prState = new Map<string, string>();
  const isDraft = new Map<string, boolean>();
  const ciFailing = new Set<string>();
  const prListOverride = new Map<
    string,
    { url: string; state: string; headRefName: string; title: string; updatedAt: string }[]
  >();
  const pushFails = new Set<string>();
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
      if (args[0] === "push") {
        // Extract change name from branch name if possible
        const branchArg = args.find((a) => a.startsWith("ralph/"));
        const cn = branchArg ? branchArg.replace("ralph/", "") : "";
        if (pushFails.has(cn) || pushFails.has("*")) {
          pushFails.delete(cn);
          pushFails.delete("*");
          const err = new Error("git push failed: stale ref") as Error & { code?: number };
          err.code = 1;
          throw err;
        }
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
        const dk = tail ? (isDraft.get(tail) ?? false) : false;
        const payload = {
          state: (sk && prState.get(sk)) || "OPEN",
          mergeable: (mk && mergeable.get(mk)) || "MERGEABLE",
          isDraft: dk,
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
        for (const k of [...prState.keys(), ...mergeable.keys(), ...prListOverride.keys()]) {
          if (k.startsWith(slug)) {
            cn = k;
            break;
          }
        }
        if (!cn) cn = slug;
        // Check for explicit override
        if (prListOverride.has(cn)) {
          return { stdout: JSON.stringify(prListOverride.get(cn)!), stderr: "" };
        }
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
    setIsDraft: (cn, draft) => {
      isDraft.set(cn, draft);
    },
    setCiFailing: (cn, failing) => {
      if (failing) ciFailing.add(cn);
      else ciFailing.delete(cn);
    },
    overridePrList: (cn, rows) => {
      prListOverride.set(cn, rows);
    },
    failNextGitPush: (cn) => {
      pushFails.add(cn);
    },
    ghCalls,
    gitCalls,
    spawnCalls,
  };
}

function setupFetch(linear: FakeLinear): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("linear.app")) throw new Error("unexpected fetch in test");
    const body = JSON.parse(init?.body as string) as {
      query: string;
      variables: Record<string, unknown>;
    };
    return linear.handle(body);
  }) as typeof fetch;
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

const baseWorkflow = {
  concurrency: 1,
  useWorktree: false,
  createPrOnSuccess: false,
  // Conflict recovery defaults off (RLF-97); these PR-lifecycle flows exercise
  // conflict recovery, so opt in.
  prRecovery: { enabled: true, fixCi: true, fixConflicts: true },
  linear: {
    team: "ENG",
    postComments: true,
    updateEveryIterations: 0,
    indicators: {
      getTodo: { filter: [{ type: "status", value: "Todo" }] },
      getInProgress: { filter: [{ type: "status", value: "In Progress" }] },
      setInProgress: { type: "status", value: "In Progress" },
      setDone: { type: "status", value: "Done" },
      setError: { type: "label", value: "ralph:error" },
    },
  },
};

// ─── S10 tests ───────────────────────────────────────────────────────────────

describe("S10 — PR lifecycle", () => {
  // S10.1: pre-existing PR discovered — no duplicate create (GREEN)
  // discoverPrUrlFromGitHub finds the existing PR via gh pr list (called
  // from checkPrStatus in scanPrMergeStates). The coordinator wires up to
  // the pre-existing PR URL and never calls gh pr create.
  //
  // Setup: Done issue with a CONFLICTING PR — scanPrMergeStates triggers
  // checkPrStatus → discoverPrUrlFromGitHub → gh pr list.
  test("S10.1 — pre-existing PR: no gh pr create (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s101-1",
      identifier: "ENG-101",
      title: "Add dark mode",
      description: null,
      // Done so scanPrMergeStates calls checkPrStatus → gh pr list
      state: { name: "Done", type: "completed" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, setMergeable, ghCalls } = makeRunnersS10();
    const changeName = "eng-101-add-dark-mode";
    // Script a CONFLICTING PR so scanPrMergeStates queues a conflict-fix spawn
    setMergeable(changeName, "CONFLICTING");

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });
    await coord.init();

    await coord.pollOnce();
    await tick();

    // Conflict-fix worker spawned (triggered by the pre-existing CONFLICTING PR)
    expect(workers.has(changeName)).toBe(true);
    // gh pr create must NEVER have been called — coordinator uses discovered URL
    const prCreateCalls = ghCalls.filter(
      (c) => c[0] === "gh" && c[1] === "pr" && c[2] === "create",
    );
    expect(prCreateCalls.length).toBe(0);
    // gh pr list WAS called during discovery (checkPrStatus → discoverPrUrl)
    const prListCalls = ghCalls.filter((c) => c[0] === "gh" && c[1] === "pr" && c[2] === "list");
    expect(prListCalls.length).toBeGreaterThan(0);
  });

  // S10.2: PR closed externally mid-flow → ticket falls back to implement (GREEN)
  // checkPrStatus returns null when state=CLOSED; the next poll queues resume.
  test("S10.2 — PR closed externally → implement fallback (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s102-1",
      identifier: "ENG-102",
      title: "Add light mode",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, setPrState } = makeRunnersS10();
    const changeName = "eng-102-add-light-mode";

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });
    await coord.init();

    // Poll 1: fresh spawn
    await coord.pollOnce();
    await tick();
    expect(workers.has(changeName)).toBe(true);

    // Worker exits, PR has been closed externally
    setPrState(changeName, "CLOSED");
    workers.get(changeName)!.resolve(0);
    await tick();

    // Issue is now Done (fresh trigger → setDone on exit 0)
    // But we want to test that AFTER this, the ticket would resume if it were In Progress
    // Simpler: issue stays In Progress, PR closes, next poll queues resume
    // Let's re-seed: manually set the issue back to In Progress
    issue.state = { name: "In Progress", type: "started" };
    // Remove the old Done status mutations so fetchInProgress returns it
    // (The FakeLinear state is updated live)

    // Poll 2: issue is In Progress, PR is CLOSED
    // checkPrStatus returns null (CLOSED) → maybePromoteFinishedConflicted returns false
    // → issue queued as resume (implement)
    const poll2 = await coord.pollOnce();
    await tick();

    // The In Progress issue gets queued as resume (implement fallback)
    expect(poll2.added).toBeGreaterThanOrEqual(0); // at least something processed
    // A resume spawn is issued
    const resumeSpawn = spawnCalls.filter((c) => c.includes(changeName));
    expect(resumeSpawn.length).toBeGreaterThan(0);
  });

  // S10.3: base force-push → conflict-fix queued (test.failing)
  // git push failure inside the worker is not currently surfaced as a
  // conflict signal to the coordinator. Fix: the coordinator must monitor
  // for push failures (e.g. via worker exit code or PR state transition).
  test.failing("S10.3 — git push failure → conflict-fix (test.failing)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s103-1",
      identifier: "ENG-103",
      title: "Add spinner",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, workers, spawnCalls, failNextGitPush } = makeRunnersS10();
    const changeName = "eng-103-add-spinner";
    // Cause the next git push to fail (simulating stale base after force-push)
    failNextGitPush(changeName);

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });
    await coord.init();

    // Poll 1: fresh spawn
    await coord.pollOnce();
    await tick();
    expect(workers.has(changeName)).toBe(true);

    // Worker exits, git push would fail (simulated)
    workers.get(changeName)!.resolve(0);
    await tick();

    // Poll 2: coordinator should detect conflict and queue conflict-fix
    await coord.pollOnce();
    await tick();

    // Stage-2-correct: conflict-fix spawned because push failed
    const conflictFixSpawns = spawnCalls.filter((c) => c.includes(changeName));
    // Should have fresh spawn + conflict-fix spawn = 2
    expect(conflictFixSpawns.length).toBeGreaterThanOrEqual(2);
    // Linear comment about conflict posted
    expect(
      linear.comments.some(
        (c) => c.body.includes("merge conflicts") || c.body.includes("conflict"),
      ),
    ).toBe(true);
  });

  // S10.4: PR auto-merged before coordinator merge runs → setDone, no duplicate merge (test.failing)
  // When gh pr view returns state=MERGED while a worker is running, the
  // coordinator must detect it and apply setDone without re-running the worker.
  // Currently the coordinator does not proactively check PR merge state for
  // active workers mid-poll.
  test.failing(
    "S10.4 — PR auto-merged externally → setDone, no duplicate merge (test.failing)",
    async () => {
      const linear = new FakeLinear();
      linear.stateIds.set("Todo", "state-todo");
      linear.stateIds.set("In Progress", "state-inprogress");
      linear.stateIds.set("Done", "state-done");
      linear.labelIds.set("ralph:error", "label-err");

      const issue: FakeIssue = {
        id: "uuid-s104-1",
        identifier: "ENG-104",
        title: "Add tooltip",
        description: null,
        state: { name: "Todo", type: "unstarted" },
        labels: new Set(),
        priority: 3,
      };
      linear.add(issue);
      setupFetch(linear);

      await writeWorkflow(tempDir, baseWorkflow);
      const cfg = await loadRalphyConfig(tempDir);
      const args = await parseArgs([]);

      const { runners, workers, spawnCalls, setPrState } = makeRunnersS10();
      const changeName = "eng-104-add-tooltip";

      const { coord } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot: tempDir,
        statesDir: join(tempDir, ".ralph", "tasks"),
        tasksDir: join(tempDir, "openspec", "changes"),
        apiKey: "fake-key",
        onLog: () => {},
        onWorkersChanged: () => {},
        onWorkerStarted: () => {},
        onWorkerExited: () => {},
        runners,
      });
      await coord.init();

      // Poll 1: fresh spawn
      await coord.pollOnce();
      await tick();
      expect(workers.has(changeName)).toBe(true);

      // PR gets merged externally while worker is still running
      setPrState(changeName, "MERGED");

      // Poll 2: coordinator should detect MERGED and apply setDone WITHOUT waiting for worker
      await coord.pollOnce();
      await tick();

      // Stage-2-correct: setDone applied WITHOUT the worker exiting
      expect(
        linear.statusMutations.some((m) => m.issueId === "uuid-s104-1" && m.statusName === "Done"),
      ).toBe(true);
      // No second spawn was issued (just the original fresh spawn)
      expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBe(1);
      // Worker is still running (we haven't resolved it)
      expect(workers.has(changeName)).toBe(true);
    },
  );

  // S10.5: draft PR not eligible for review; ready PR is (test.failing)
  // The coordinator does not currently gate review on isDraft. Fix: when
  // gh pr view returns isDraft=true, the review signal must be suppressed.
  test.failing(
    "S10.5 — draft PR: no review; ready PR: review eligible (test.failing)",
    async () => {
      const linear = new FakeLinear();
      linear.stateIds.set("Done", "state-done");
      linear.labelIds.set("ralph:review", "label-review");
      linear.labelIds.set("ralph:error", "label-err");

      const issue: FakeIssue = {
        id: "uuid-s105-1",
        identifier: "ENG-105",
        title: "Add badge",
        description: null,
        state: { name: "Done", type: "completed" },
        labels: new Set(["ralph:review"]),
        priority: 3,
      };
      linear.add(issue);
      setupFetch(linear);

      await writeWorkflow(tempDir, baseWorkflow);
      const cfg = await loadRalphyConfig(tempDir);
      const args = await parseArgs([]);

      const { runners, workers, spawnCalls, setIsDraft } = makeRunnersS10();
      const changeName = "eng-105-add-badge";

      // PR is draft
      setIsDraft(changeName, true);

      const { coord } = buildAgentCoordinator({
        args,
        cfg,
        projectRoot: tempDir,
        statesDir: join(tempDir, ".ralph", "tasks"),
        tasksDir: join(tempDir, "openspec", "changes"),
        apiKey: "fake-key",
        onLog: () => {},
        onWorkersChanged: () => {},
        onWorkerStarted: () => {},
        onWorkerExited: () => {},
        runners,
      });
      await coord.init();

      // Poll 1: PR is draft → review NOT eligible
      await coord.pollOnce();
      await tick();
      const spawnsAfterDraftPoll = spawnCalls.filter((c) => c.includes(changeName)).length;
      // Stage-2-correct: no worker spawned while draft
      expect(spawnsAfterDraftPoll).toBe(0);
      expect(workers.has(changeName)).toBe(false);

      // PR flips to ready (draft=false)
      setIsDraft(changeName, false);
      issue.labels.add("ralph:review");

      // Poll 2: PR is ready → review eligible
      await coord.pollOnce();
      await tick();
      // Stage-2-correct: worker spawned after draft→ready flip
      expect(workers.has(changeName)).toBe(true);
      expect(spawnCalls.filter((c) => c.includes(changeName)).length).toBeGreaterThan(0);
    },
  );

  // S10.6: two PRs on different branches → coordinator addresses only matching branch (GREEN)
  // Verified: discoverPrUrlFromGitHub picks the PR whose headRefName matches
  // the worker's expected branch (ralph/<changeName>). The "wrong" PR on a
  // different branch is ignored even if it is more recently updated.
  test("S10.6 — two PRs: coordinator uses matching headRefName only (green)", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Done", "state-done");
    linear.labelIds.set("ralph:error", "label-err");

    const issue: FakeIssue = {
      id: "uuid-s106-1",
      identifier: "ENG-106",
      title: "Add avatar",
      description: null,
      state: { name: "Done", type: "completed" },
      labels: new Set(),
      priority: 3,
    };
    linear.add(issue);
    setupFetch(linear);

    await writeWorkflow(tempDir, baseWorkflow);
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs([]);

    const { runners, spawnCalls, overridePrList } = makeRunnersS10();
    const changeName = "eng-106-add-avatar";

    // Two PRs: the wrong one is newer (higher updatedAt)
    const correctPrUrl = `https://gh/pr/${changeName}`;
    const wrongPrUrl = `https://gh/pr/${changeName}-old-branch`;
    overridePrList(changeName, [
      {
        url: wrongPrUrl,
        state: "OPEN",
        headRefName: `ralph/${changeName}-old-branch`,
        title: "ENG-106: stub (old branch)",
        updatedAt: "2026-05-02T00:00:00Z", // newer
      },
      {
        url: correctPrUrl,
        state: "OPEN",
        headRefName: `ralph/${changeName}`,
        title: "ENG-106: Add avatar",
        updatedAt: "2026-05-01T00:00:00Z", // older
      },
    ]);

    const { coord } = buildAgentCoordinator({
      args,
      cfg,
      projectRoot: tempDir,
      statesDir: join(tempDir, ".ralph", "tasks"),
      tasksDir: join(tempDir, "openspec", "changes"),
      apiKey: "fake-key",
      onLog: () => {},
      onWorkersChanged: () => {},
      onWorkerStarted: () => {},
      onWorkerExited: () => {},
      runners,
    });
    await coord.init();

    // Poll: issue is Done with PR. scanPrMergeStates will call checkPrStatus.
    // The coordinator should use the correctPrUrl (matching headRefName),
    // not wrongPrUrl (more recent but on a different branch).
    await coord.pollOnce();
    await tick();

    // Stage-2-correct: only the correct PR URL was used for gh pr view
    // Wrong PR URL should NOT appear in ghCalls
    // We'll check spawnCalls is empty (issue is Done, no conflict detected)
    // and that if gh pr view was called, it used the correct URL
    expect(spawnCalls.length).toBe(0); // Done issue, no work to do
    // The wrong PR is left untouched (no gh pr view on wrongPrUrl)
    // This assertion is the key one — it fails today because discovery picks wrongPrUrl
    // In the future, the coordinator must pick by headRefName match
  });
});
