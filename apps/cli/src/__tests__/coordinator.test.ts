import { describe, expect, test, mock } from "bun:test";
import {
  AgentCoordinator,
  type CoordinatorDeps,
  type CoordinatorStore,
  type IssueUpdater,
} from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import type { AgentState, TaskEntry } from "../agent/state";

class FakeStore implements CoordinatorStore {
  readonly saved: AgentState[] = [];
  constructor(private state: AgentState = { tasks: {}, lastPollAt: null }) {}
  snapshot(): AgentState {
    return this.state;
  }
  async upsertTask(
    issue: { id: string; identifier: string },
    patch: Partial<TaskEntry>,
  ): Promise<void> {
    const existing = this.state.tasks[issue.identifier];
    this.state.tasks[issue.identifier] = {
      issueId: issue.id,
      identifier: issue.identifier,
      state: existing?.state ?? "started",
      ...existing,
      ...patch,
    };
    this.saved.push(JSON.parse(JSON.stringify(this.state)));
  }
  async setLastPollAt(when: string | null): Promise<void> {
    this.state.lastPollAt = when;
    this.saved.push(JSON.parse(JSON.stringify(this.state)));
  }
  async removeByChangeName(
    changeName: string,
  ): Promise<{ identifier: string; issueId: string } | null> {
    const entry = Object.values(this.state.tasks).find((t) => t.changeName === changeName);
    if (!entry) return null;
    delete this.state.tasks[entry.identifier];
    this.saved.push(JSON.parse(JSON.stringify(this.state)));
    return { identifier: entry.identifier, issueId: entry.issueId };
  }
}

function issue(
  id: string,
  identifier: string,
  priority = 3,
  blockedByIds: string[] = [],
): LinearIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    labels: [],
    priority,
    blockedByIds,
  };
}

interface FakeWorker {
  resolve: (code: number) => void;
  killed: boolean;
}

function makeDeps(
  initial: Partial<{
    issues: LinearIssue[];
    state: AgentState;
    fetchImpl: () => Promise<LinearIssue[]>;
    scaffoldImpl: (issue: LinearIssue) => Promise<string>;
  }> = {},
): {
  deps: CoordinatorDeps;
  workers: Map<string, FakeWorker>;
  logs: { text: string; color?: string }[];
  saved: AgentState[];
} {
  const workers = new Map<string, FakeWorker>();
  const logs: { text: string; color?: string }[] = [];
  const store = new FakeStore(initial.state ?? { tasks: {}, lastPollAt: null });

  const deps: CoordinatorDeps = {
    fetchIssues: initial.fetchImpl ?? mock(async () => initial.issues ?? []),
    scaffold:
      initial.scaffoldImpl ??
      mock(async (i: LinearIssue) => `change-${i.identifier.toLowerCase()}`),
    spawnWorker: mock((changeName: string) => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      const w: FakeWorker = { resolve, killed: false };
      workers.set(changeName, w);
      return {
        exited,
        kill: () => {
          w.killed = true;
          resolve(143);
        },
      };
    }),
    store,
    onLog: (text, color) => {
      logs.push(color !== undefined ? { text, color } : { text });
    },
    onWorkersChanged: () => {},
  };
  return { deps, workers, logs, saved: store.saved };
}

describe("AgentCoordinator", () => {
  test("polls, scaffolds, and respects concurrency cap", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2"), issue("c", "ENG-3")];
    const { deps, workers } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 2, filter: {} });
    await coord.init();

    const result = await coord.pollOnce();
    expect(result).toEqual({ found: 3, added: 3 });
    // Wait a microtask for async scaffold + spawn
    await new Promise((r) => setTimeout(r, 5));

    expect(coord.activeCount).toBe(2);
    expect(coord.queuedCount).toBe(1);
    expect(workers.size).toBe(2);
  });

  test("queue is ordered by priority: urgent before medium before low before no-priority", async () => {
    const issues = [
      issue("low", "ENG-1", 4),
      issue("urgent", "ENG-2", 1),
      issue("none", "ENG-3", 0),
      issue("medium", "ENG-4", 3),
    ];
    const { deps, workers } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));

    // First spawned: urgent (priority 1)
    expect(workers.has("change-eng-2")).toBe(true);
    expect(coord.queuedCount).toBe(3);

    workers.get("change-eng-2")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    // Second: medium (priority 3)
    expect(workers.has("change-eng-4")).toBe(true);

    workers.get("change-eng-4")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    // Third: low (priority 4)
    expect(workers.has("change-eng-1")).toBe(true);

    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    // Last: no priority (0 → sorted last)
    expect(workers.has("change-eng-3")).toBe(true);

    workers.get("change-eng-3")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(0);
  });

  test("queue drains as workers exit, marking only success as processed", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2"), issue("c", "ENG-3")];
    const { deps, workers, saved } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));

    expect(coord.activeCount).toBe(1);
    // Fail the first worker -> not processed, next dequeues
    workers.get("change-eng-1")!.resolve(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(1);
    expect(workers.size).toBe(2);
    // Succeed the second -> processed
    workers.get("change-eng-2")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    // Last worker
    workers.get("change-eng-3")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(0);

    const last = saved[saved.length - 1]!;
    const processed = Object.values(last.tasks)
      .filter((t) => t.state === "processed")
      .map((t) => t.issueId);
    expect(processed).toContain("b");
    expect(processed).toContain("c");
    expect(processed).not.toContain("a");
  });

  test("re-poll dedupes against processed, queued, active, and pending", async () => {
    let resolveScaffold!: (name: string) => void;
    const scaffoldImpl = (i: LinearIssue) =>
      new Promise<string>((r) => {
        resolveScaffold = (n) => r(n);
        // for second issue, resolve immediately
        if (i.id !== "a") r(`change-${i.identifier.toLowerCase()}`);
      });
    const issues = [issue("a", "ENG-1")];
    const { deps } = makeDeps({ issues, scaffoldImpl });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();

    await coord.pollOnce();
    // worker is in pending state (scaffold not resolved)
    expect(coord.queuedCount).toBe(0);

    // re-poll while still pending — should not re-queue
    const r2 = await coord.pollOnce();
    expect(r2.added).toBe(0);

    // resolve scaffold so the worker becomes active
    resolveScaffold("change-eng-1");
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(1);

    // re-poll while active — still no duplicate
    const r3 = await coord.pollOnce();
    expect(r3.added).toBe(0);
  });

  test("non-zero exit quarantines the issue; next poll skips it", async () => {
    const issues = [issue("a", "ENG-1")];
    const { deps, workers, saved } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();

    const r1 = await coord.pollOnce();
    expect(r1.added).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(1);

    // Worker fails.
    workers.get("change-eng-1")!.resolve(71);
    await new Promise((r) => setTimeout(r, 5));

    // failed state was persisted.
    const last = saved[saved.length - 1]!;
    expect(last.tasks["ENG-1"]?.state).toBe("failed");
    expect(last.tasks["ENG-1"]?.exitCode).toBe(71);

    // Re-poll: same issue still in Linear, but now skipped.
    const r2 = await coord.pollOnce();
    expect(r2.found).toBe(1);
    expect(r2.added).toBe(0);
    expect(coord.activeCount).toBe(0);
  });

  test("scaffold failure releases the slot and triggers next", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2")];
    let count = 0;
    const scaffoldImpl = async (i: LinearIssue) => {
      count++;
      if (i.id === "a") throw new Error("disk full");
      return `change-${i.identifier.toLowerCase()}`;
    };
    const { deps, logs } = makeDeps({ issues, scaffoldImpl });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));

    expect(count).toBe(2);
    expect(coord.activeCount).toBe(1);
    expect(logs.some((l) => l.text.includes("scaffold failed for ENG-1"))).toBe(true);
  });

  test("fetch failure logs and returns zero counts", async () => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const { deps, logs } = makeDeps({ fetchImpl });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r).toEqual({ found: 0, added: 0 });
    expect(logs.some((l) => l.text.includes("Linear poll failed: network down"))).toBe(true);
  });

  test("stop kills active workers and prevents new spawns", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2")];
    const { deps, workers } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));
    expect(coord.activeCount).toBe(1);

    coord.stop();
    expect(workers.get("change-eng-1")!.killed).toBe(true);

    // pollOnce becomes a no-op
    const r = await coord.pollOnce();
    expect(r).toEqual({ found: 0, added: 0 });
  });

  test("blocked issue is skipped while blocker is unresolved", async () => {
    const issues = [issue("blocker", "ENG-1"), issue("blocked", "ENG-2", 3, ["blocker"])];
    const { deps, workers, logs } = makeDeps({ issues });
    const coord = new AgentCoordinator(deps, { concurrency: 2, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));

    // Only blocker spawned; blocked issue skipped
    expect(coord.activeCount).toBe(1);
    expect(workers.has("change-eng-1")).toBe(true);
    expect(workers.has("change-eng-2")).toBe(false);
    expect(logs.some((l) => l.text.includes("ENG-2") && l.text.includes("blocked"))).toBe(true);
  });

  test("blocked issue becomes eligible once blocker is processed", async () => {
    const blocker = issue("blocker", "ENG-1");
    const blocked = issue("blocked", "ENG-2", 3, ["blocker"]);
    let poll2Issues: LinearIssue[] = [blocker, blocked];
    const { deps, workers } = makeDeps({
      fetchImpl: async () => poll2Issues,
    });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();

    // First poll: only blocker queued
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));
    expect(workers.has("change-eng-1")).toBe(true);
    expect(coord.queuedCount).toBe(0);

    // Blocker completes
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 5));

    // Second poll: blocked issue is now eligible (blocker is processed)
    // Update the returned issues to reflect blocker is no longer blocking
    poll2Issues = [blocked]; // blocker won't re-appear (or is already processed)
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));
    expect(workers.has("change-eng-2")).toBe(true);
  });

  test("issue with all blockers processed is not skipped", async () => {
    const issues = [issue("b", "ENG-2", 3, ["already-done"])];
    const { deps, workers } = makeDeps({
      issues,
      state: {
        tasks: {
          "DONE-1": {
            issueId: "already-done",
            identifier: "DONE-1",
            state: "processed",
          },
        },
        lastPollAt: null,
      },
    });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));
    expect(workers.has("change-eng-2")).toBe(true);
  });

  test("activeWorkers exposes worker descriptors", async () => {
    const { deps } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 5));
    const ws = coord.activeWorkers;
    expect(ws).toHaveLength(1);
    expect(ws[0]!.issueId).toBe("a");
    expect(ws[0]!.issueIdentifier).toBe("ENG-1");
    expect(ws[0]!.changeName).toBe("change-eng-1");
  });
});

describe("AgentCoordinator + IssueUpdater", () => {
  function makeUpdater(): {
    updater: IssueUpdater;
    comments: { id: string; body: string }[];
    moves: { id: string; stateId: string }[];
    labels: { id: string; labelId: string }[];
  } {
    const comments: { id: string; body: string }[] = [];
    const moves: { id: string; stateId: string }[] = [];
    const labels: { id: string; labelId: string }[] = [];
    const updater: IssueUpdater = {
      postComment: async (i, body) => {
        comments.push({ id: i.id, body });
      },
      setState: async (i, stateId) => {
        moves.push({ id: i.id, stateId });
      },
      resolveStateId: async (_i, name) => {
        if (name === "missing") return null;
        return `state-${name.toLowerCase().replace(/\s+/g, "-")}`;
      },
      resolveLabelId: async (_i, name) => {
        if (name === "missing-label") return null;
        return `label-${name.toLowerCase().replace(/\s+/g, "-")}`;
      },
      addLabel: async (i, labelId) => {
        labels.push({ id: i.id, labelId });
      },
    };
    return { updater, comments, moves, labels };
  }

  test("posts start/exit comments and moves through inProgress + done", async () => {
    const issues = [issue("a", "ENG-1")];
    const { deps, workers } = makeDeps({ issues });
    const { updater, comments, moves } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      inProgressStatus: "In Progress",
      doneStatus: "In Review",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));

    expect(comments[0]!.body).toContain("started working");
    expect(moves[0]).toEqual({ id: "a", stateId: "state-in-progress" });

    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));

    expect(comments[1]!.body).toContain("completed work");
    expect(moves[1]).toEqual({ id: "a", stateId: "state-in-review" });
  });

  test("does not move to done when worker exits non-zero", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, comments, moves } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneStatus: "In Review",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(2);
    await new Promise((r) => setTimeout(r, 10));

    expect(moves).toEqual([]);
    expect(comments[1]!.body).toContain("exited with code 2");
  });

  test("postComments=false suppresses comments but still moves state", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, comments, moves } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      inProgressStatus: "In Progress",
      postComments: false,
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));

    expect(comments).toEqual([]);
    expect(moves).toHaveLength(1);

    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(comments).toEqual([]);
  });

  test("logs warning when target state name is unknown", async () => {
    const { deps, workers, logs } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      inProgressStatus: "missing",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.text.includes("'missing' not found"))).toBe(true);
  });

  test("logs error and continues when comment posting fails", async () => {
    const { deps, workers, logs } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const updater: IssueUpdater = {
      postComment: async () => {
        throw new Error("rate limited");
      },
      setState: async () => {},
      resolveStateId: async () => "state-1",
    };
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, { concurrency: 1, filter: {} });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.text.includes("Linear comment failed"))).toBe(true);
  });

  test("no updater means no Linear side effects", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    // deps.updater intentionally not set
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      inProgressStatus: "In Progress",
      doneStatus: "Done",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    // no crash, worker completed normally
    expect(coord.activeCount).toBe(0);
  });

  test("doneLabel adds the label on success", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, labels } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneLabel: "ralphy-done",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(labels).toEqual([{ id: "a", labelId: "label-ralphy-done" }]);
  });

  test("doneLabel and doneStatus both apply on success", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, moves, labels } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneStatus: "Done",
      doneLabel: "ralphy-done",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(moves).toEqual([{ id: "a", stateId: "state-done" }]);
    expect(labels).toEqual([{ id: "a", labelId: "label-ralphy-done" }]);
  });

  test("doneLabel does not apply on non-zero exit", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, labels } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneLabel: "ralphy-done",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(2);
    await new Promise((r) => setTimeout(r, 10));
    expect(labels).toEqual([]);
  });

  test("logs warning when target label name is unknown", async () => {
    const { deps, workers, logs } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater } = makeUpdater();
    deps.updater = updater;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneLabel: "missing-label",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.text.includes("'missing-label' not found"))).toBe(true);
  });

  test("posts a progress comment on each new iteration milestone", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, comments } = makeUpdater();
    deps.updater = updater;
    let count = 0;
    deps.getIterationCount = async () => count;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      commentEveryIterations: 10,
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    // Worker is active. Initial iteration 0 → no progress comment yet.
    expect(comments.filter((c) => c.body.includes("progress"))).toHaveLength(0);

    // Below threshold — still no comment.
    count = 7;
    await coord.pollOnce();
    expect(comments.filter((c) => c.body.includes("progress"))).toHaveLength(0);

    // Cross first milestone (10).
    count = 10;
    await coord.pollOnce();
    expect(comments.filter((c) => c.body.includes("iteration 10"))).toHaveLength(1);

    // Same milestone — no duplicate.
    count = 14;
    await coord.pollOnce();
    expect(comments.filter((c) => c.body.includes("progress"))).toHaveLength(1);

    // Cross second milestone (20).
    count = 22;
    await coord.pollOnce();
    expect(comments.filter((c) => c.body.includes("iteration 22"))).toHaveLength(1);

    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
  });

  test("commentEveryIterations=0 disables progress comments", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, comments } = makeUpdater();
    deps.updater = updater;
    deps.getIterationCount = async () => 99;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      commentEveryIterations: 0,
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    await coord.pollOnce();
    expect(comments.filter((c) => c.body.includes("progress"))).toHaveLength(0);
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
  });

  test("postComments=false suppresses progress comments too", async () => {
    const { deps, workers } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater, comments } = makeUpdater();
    deps.updater = updater;
    deps.getIterationCount = async () => 50;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      commentEveryIterations: 10,
      postComments: false,
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    await coord.pollOnce();
    expect(comments).toEqual([]);
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
  });

  test("getIterationCount failure logs warning and continues", async () => {
    const { deps, workers, logs } = makeDeps({ issues: [issue("a", "ENG-1")] });
    const { updater } = makeUpdater();
    deps.updater = updater;
    deps.getIterationCount = async () => {
      throw new Error("disk read failed");
    };
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      commentEveryIterations: 10,
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    await coord.pollOnce();
    expect(logs.some((l) => l.text.includes("iteration count read failed"))).toBe(true);
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
  });

  test("logs warning when updater lacks label support but doneLabel set", async () => {
    const { deps, workers, logs } = makeDeps({ issues: [issue("a", "ENG-1")] });
    // Updater without resolveLabelId / addLabel
    const partial: IssueUpdater = {
      postComment: async () => {},
      setState: async () => {},
      resolveStateId: async () => "x",
    };
    deps.updater = partial;
    const coord = new AgentCoordinator(deps, {
      concurrency: 1,
      filter: {},
      doneLabel: "ralphy-done",
    });
    await coord.init();
    await coord.pollOnce();
    await new Promise((r) => setTimeout(r, 10));
    workers.get("change-eng-1")!.resolve(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(logs.some((l) => l.text.includes("does not support labels"))).toBe(true);
  });
});
