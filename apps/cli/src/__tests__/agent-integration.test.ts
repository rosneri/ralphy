/**
 * Highest-level integration test for agent mode. Exercises the real
 *   parseArgs → loadRalphyConfig → buildAgentCoordinator → coord.pollOnce()
 * pipeline in one process. Only third parties and side-effects are mocked:
 *   - Linear API (globalThis.fetch)
 *   - git (GitRunner)
 *   - gh / generic command (CmdRunner)
 *   - the worker subprocess (`spawnWorker`)
 *   - shell scripts (`runScript`)
 *
 * The scaffold (file writes), worktree directory layout, indicator merging,
 * dedup, conflict scan, and prepare/spawn flow run for real.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "../cli";
import { loadRalphyConfig } from "../agent/config";
import { buildAgentCoordinator, type AgentRunners } from "../agent/wire";
import type { GitRunner } from "../agent/worktree";
import type { CmdRunner } from "../agent/pr";

let tempDir: string;
let originalFetch: typeof fetch;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "agent-int-"));
  // Make the project root look like an OpenSpec project so findProjectRoot
  // (in production) and the layout helpers behave normally.
  await mkdir(join(tempDir, "openspec", "changes"), { recursive: true });
  await mkdir(join(tempDir, ".ralph", "tasks"), { recursive: true });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  state: { name: string; type: string };
  labels: Set<string>;
  priority: number;
}

/**
 * In-memory Linear backend. Mirrors the GraphQL responses that
 * fetchOpenIssues / addIssueComment / updateIssueState / addLabelToIssue /
 * removeLabelFromIssue / fetchIssueLabels / fetchWorkflowStates expect.
 *
 * The backend is intentionally tiny: a Map of issues with mutable state +
 * label set, plus call recorders so tests can assert what happened.
 */
class FakeLinear {
  issues = new Map<string, FakeIssue>();
  comments: { issueId: string; body: string }[] = [];
  labelMutations: { issueId: string; op: "add" | "remove"; labelName: string }[] = [];
  statusMutations: { issueId: string; statusName: string }[] = [];
  /** name → id; both labels and workflow states share the namespace here for simplicity. */
  labelIds = new Map<string, string>();
  stateIds = new Map<string, string>();

  add(issue: FakeIssue): void {
    this.issues.set(issue.id, issue);
  }

  /** Match an issue against a Linear-shaped IssueFilter (only the bits the
   *  agent actually emits — `or` of state/labels, `and`, `state.name`,
   *  `labels.some`, `labels.every`, plus `team`/`assignee` ignored). */
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

  /** GraphQL handler. Returns the Response the agent expects. */
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
      const stateId = body.variables.stateId as string;
      const id = body.variables.id as string;
      // Reverse-lookup the state name from stateIds.
      const stateName = [...this.stateIds.entries()].find(([, v]) => v === stateId)?.[0];
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
              nodes: [...this.labelIds.entries()].map(([name, id]) => ({ id, name })),
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
    if (q.includes("issue(id")) {
      // fetchIssueComments
      return new Response(JSON.stringify({ data: { issue: { comments: { nodes: [] } } } }));
    }
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }
}

interface FakeWorker {
  resolve: (code: number) => void;
}

/** Fake side-effect runners that record calls and let the test drive
 *  worker exits. */
function makeRunners(): {
  runners: AgentRunners;
  workers: Map<string, FakeWorker>;
  /** What `gh pr view --json mergeable` should report for the next call. */
  setMergeable: (changeName: string, mergeable: "MERGEABLE" | "CONFLICTING") => void;
  ghCalls: string[][];
  gitCalls: string[][];
} {
  const workers = new Map<string, FakeWorker>();
  const mergeable = new Map<string, string>();
  const ghCalls: string[][] = [];
  const gitCalls: string[][] = [];

  const git: GitRunner = {
    run: async (args, _cwd) => {
      gitCalls.push(args);
      // Pretend everything succeeds, and `worktree list --porcelain` says
      // no existing worktree (so createWorktree no-ops `worktree add`).
      if (args[0] === "worktree" && args[1] === "list") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse") {
        // branch doesn't exist locally
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
      // gh pr view --json mergeable --jq .mergeable
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "view") {
        const url = cmdArr[3] ?? "";
        // url looks like https://gh/pr/<changeName>; map back via mergeable map
        const cn = url.split("/").pop() ?? "";
        return { stdout: mergeable.get(cn) ?? "MERGEABLE", stderr: "" };
      }
      // gh pr list --head <branch> --state open ...
      if (cmdArr[0] === "gh" && cmdArr[1] === "pr" && cmdArr[2] === "list") {
        const headIdx = cmdArr.indexOf("--head");
        const branch = headIdx >= 0 ? cmdArr[headIdx + 1] : "";
        const cn = branch?.replace(/^ralph\//, "") ?? "";
        // Pretend a PR exists at https://gh/pr/<cn>
        return { stdout: `https://gh/pr/${cn}`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
  };

  const spawnWorker = (_cmd: string[], _cwd: string) => {
    let resolve!: (code: number) => void;
    const exited = new Promise<number>((r) => {
      resolve = r;
    });
    // Key by the changeName which is _cmd[3] (since cmd is
    // [bun, cli.js, "task", "--name", changeName, ...])
    const idx = _cmd.indexOf("--name");
    const key = idx >= 0 ? _cmd[idx + 1]! : `worker-${workers.size}`;
    workers.set(key, { resolve });
    return { exited, kill: () => resolve(143) };
  };

  return {
    runners: {
      git,
      cmd,
      spawnWorker,
      runScript: async () => 0,
    },
    workers,
    setMergeable: (cn, m) => {
      mergeable.set(cn, m);
    },
    ghCalls,
    gitCalls,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

describe("agent integration — Linear-as-source-of-truth lifecycle", () => {
  test("end-to-end: poll → setInProgress → spawn → exit → setDone, then conflict scan flips to setConflicted and re-fixes", async () => {
    // ---- 1. Config + Linear stub ----
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
        const err = new Error("unexpected fetch in test") as Error & { url?: string };
        err.url = url;
        throw err;
      }
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      return linear.handle(body);
    }) as typeof fetch;

    // Write a real config and parse args through the real CLI parser.
    await Bun.write(
      join(tempDir, "ralphy.config.json"),
      JSON.stringify({
        concurrency: 1,
        useWorktree: false, // simpler — no worktree dance in this test
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
      }),
    );
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs(["agent"]);

    // ---- 2. Side-effect runners ----
    const { runners, workers, setMergeable } = makeRunners();
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

    // ---- 3. First poll: pickup, setInProgress, scaffold, spawn ----
    const poll1 = await coord.pollOnce();
    expect(poll1.added).toBe(1);
    await tick();

    // setInProgress was applied via the status mutation
    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "In Progress",
    });

    // Scaffold happened on disk
    const changeName = "eng-1-add-dark-mode";
    expect(existsSync(join(tempDir, "openspec", "changes", changeName, "tasks.md"))).toBe(true);
    const proposal = readFileSync(
      join(tempDir, "openspec", "changes", changeName, "proposal.md"),
      "utf-8",
    );
    expect(proposal).toContain("ENG-1");
    expect(proposal).toContain("Users want dark mode");

    // Worker spawned
    expect(workers.has(changeName)).toBe(true);

    // Started comment posted (postComments=true)
    expect(linear.comments.some((c) => c.body.includes("Ralph started working"))).toBe(true);

    // ---- 4. Worker exits cleanly → setDone ----
    workers.get(changeName)!.resolve(0);
    await tick();

    expect(linear.statusMutations).toContainEqual({
      issueId: "uuid-eng-1",
      statusName: "Done",
    });
    expect(linear.comments.some((c) => c.body.includes("Ralph completed"))).toBe(true);

    // The issue's status is now "Done" in the fake; subsequent getTodo
    // polls won't pick it up.
    expect(linear.issues.get("uuid-eng-1")!.state.name).toBe("Done");

    // ---- 5. Re-poll: nothing to do ----
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);

    // ---- 6. Simulate main moving forward — PR is now CONFLICTING ----
    setMergeable(changeName, "CONFLICTING");

    const poll3 = await coord.pollOnce();
    await tick();

    // setConflicted label applied, conflict comment posted, conflict-fix
    // worker re-spawned (since we cleared workers map after exit, we'd
    // expect a new entry).
    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-1",
      ),
    ).toBe(true);
    expect(linear.comments.some((c) => c.body.includes("merge conflicts"))).toBe(true);
    void poll3; // not asserting `added` here — conflict-scan adds out-of-band

    // Worker for the conflict-fix run is active.
    const fixWorker = workers.get(changeName);
    expect(fixWorker).toBeDefined();

    // ---- 7. Conflict-fix worker exits cleanly → clearConflicted ----
    fixWorker!.resolve(0);
    await tick();

    expect(
      linear.labelMutations.some(
        (m) =>
          m.op === "remove" && m.labelName === "ralph:conflicted" && m.issueId === "uuid-eng-1",
      ),
    ).toBe(true);

    // setDone is NOT applied a second time (already done; conflict-fix
    // path skips setDone).
    const doneCount = linear.statusMutations.filter((s) => s.statusName === "Done").length;
    expect(doneCount).toBe(1);
  });

  test("worker non-zero exit applies setError; subsequent poll does not re-pick", async () => {
    const linear = new FakeLinear();
    linear.stateIds.set("Todo", "state-todo");
    linear.stateIds.set("In Progress", "state-inprogress");
    linear.labelIds.set("ralph:error", "label-err");
    linear.add({
      id: "uuid-eng-2",
      identifier: "ENG-2",
      title: "Bad task",
      description: null,
      state: { name: "Todo", type: "unstarted" },
      labels: new Set(),
      priority: 3,
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      void input;
      return linear.handle(body);
    }) as typeof fetch;

    await Bun.write(
      join(tempDir, "ralphy.config.json"),
      JSON.stringify({
        useWorktree: false,
        linear: {
          team: "ENG",
          postComments: false,
          indicators: {
            getTodo: { filter: [{ type: "status", value: "Todo" }] },
            setInProgress: { type: "status", value: "In Progress" },
            setError: { type: "label", value: "ralph:error" },
          },
        },
      }),
    );
    const cfg = await loadRalphyConfig(tempDir);
    const args = await parseArgs(["agent"]);

    const { runners, workers } = makeRunners();
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

    workers.get("eng-2-bad-task")!.resolve(2);
    await tick();

    expect(
      linear.labelMutations.some(
        (m) => m.op === "add" && m.labelName === "ralph:error" && m.issueId === "uuid-eng-2",
      ),
    ).toBe(true);

    // The fake's getTodo filter excludes ralph:error via the auto-built
    // exclude list. Re-poll should add nothing.
    const poll2 = await coord.pollOnce();
    expect(poll2.added).toBe(0);
  });
});
