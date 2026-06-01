import { describe, expect, test, mock } from "bun:test";
import {
  AgentCoordinator,
  type CoordinatorDeps,
  type QueueTrigger,
  type MentionTrigger,
} from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import type { SetIndicator } from "@ralphy/types";
import type { FeatureCtx } from "../features/types";
import { createNoopBus } from "@ralphy/events";
import { PrTracker } from "../features/pr-tracker/tracker";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Build a `buildFeatureCtx` factory that makes the confirmation feature
 *  claim issues whose ids appear in `gatedIds`. Used to exercise the
 *  registry walk in tests that previously poked the now-removed
 *  `classifyAwaitingConfirmation` dep. */
function gatedCtxFactory(gatedIds: ReadonlySet<string>): (issue: LinearIssue) => FeatureCtx {
  return (issue) =>
    ({
      issue,
      worktree: "/tmp",
      state: { writeField: async () => {} },
      bus: createNoopBus(),
      caps: {
        gh: null,
        linear: null,
        git: null,
        fsChange: null,
        worker: null,
        confirmation: {
          detect: async (i: LinearIssue) => gatedIds.has(i.id),
          run: async () => {},
        },
      },
      poll: {} as FeatureCtx["poll"],
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    }) as FeatureCtx;
}

function issue(
  id: string,
  identifier: string,
  priority = 3,
  blockedByIds: string[] = [],
  createdAt = "2026-01-01T00:00:00.000Z",
): LinearIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority,
    createdAt,
    blockedByIds,
  };
}

interface FakeWorker {
  resolve: (code: number) => void;
  killed: boolean;
}

interface DepsResult {
  deps: CoordinatorDeps;
  workers: Map<string, FakeWorker>;
  logs: { text: string; color?: string }[];
  fileLogs: string[];
  applies: { id: string; ind: SetIndicator }[];
  removes: { id: string; ind: SetIndicator }[];
  comments: { id: string; body: string }[];
  conflictByIssue: Map<
    string,
    { url: string; status: "mergeable" | "conflicted" | "ci_failed" | "unknown" } | null
  >;
  /** Set of issue IDs whose openspec change is "archived locally" for tests. */
  archivedIssues: Set<string>;
  /** Update what fetchTodo returns on the next call. */
  setTodo: (issues: LinearIssue[]) => void;
  setInProgress: (issues: LinearIssue[]) => void;
  setMentions: (mentions: { issue: LinearIssue; trigger: MentionTrigger }[]) => void;
  setDoneCandidates: (issues: LinearIssue[]) => void;
}

function makeDeps(initial: { todo?: LinearIssue[] } = {}): DepsResult {
  const workers = new Map<string, FakeWorker>();
  const logs: { text: string; color?: string }[] = [];
  const fileLogs: string[] = [];
  const applies: { id: string; ind: SetIndicator }[] = [];
  const removes: { id: string; ind: SetIndicator }[] = [];
  const comments: { id: string; body: string }[] = [];
  const conflictByIssue = new Map<
    string,
    { url: string; status: "mergeable" | "conflicted" | "ci_failed" | "unknown" } | null
  >();
  const archivedIssues = new Set<string>();

  let todo: LinearIssue[] = initial.todo ?? [];
  let inProgress: LinearIssue[] = [];
  let mentions: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
  let doneCandidates: LinearIssue[] = [];

  const deps: CoordinatorDeps = {
    fetchTodo: mock(async () => todo),
    fetchInProgress: mock(async () => inProgress),
    fetchMentions: mock(async () => mentions),
    fetchDoneCandidates: mock(async () => doneCandidates),
    prepare: mock(async (i: LinearIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    prepareTaskForTrigger: mock(
      async (_i: LinearIssue, _name: string, _t: QueueTrigger, _m?: MentionTrigger) => {},
    ),
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
    applyIndicator: async (i, ind) => {
      applies.push({ id: i.id, ind });
    },
    removeIndicator: async (i, ind) => {
      removes.push({ id: i.id, ind });
    },
    postComment: async (i, body) => {
      comments.push({ id: i.id, body });
    },
    fetchComments: async () => [],
    checkPrStatus: async (i) => conflictByIssue.get(i.id) ?? null,
    isChangeArchivedForIssue: async (i) => archivedIssues.has(i.id),
    onLog: (text, color) => {
      logs.push(color !== undefined ? { text, color } : { text });
    },
    onFileLog: (text) => {
      fileLogs.push(text);
    },
    onWorkersChanged: () => {},
  };

  return {
    deps,
    workers,
    logs,
    fileLogs,
    applies,
    removes,
    comments,
    conflictByIssue,
    archivedIssues,
    setTodo: (xs) => {
      todo = xs;
    },
    setInProgress: (xs) => {
      inProgress = xs;
    },
    setMentions: (xs) => {
      mentions = xs;
    },
    setDoneCandidates: (xs) => {
      doneCandidates = xs;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("AgentCoordinator — todo polling", () => {
  test("polls, prepares, and respects concurrency cap", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2"), issue("c", "ENG-3")];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 2 });
    await coord.init();

    const result = await coord.pollOnce();
    expect({ found: result.found, added: result.added }).toEqual({ found: 3, added: 3 });
    await tick();

    expect(coord.activeCount).toBe(2);
    expect(coord.queuedCount).toBe(1);
    expect(ctx.workers.size).toBe(2);
  });

  test("queue is ordered by priority (Urgent → No-priority)", async () => {
    const issues = [
      issue("low", "ENG-1", 4),
      issue("urgent", "ENG-2", 1),
      issue("none", "ENG-3", 0),
      issue("medium", "ENG-4", 3),
    ];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-2")).toBe(true);
    ctx.workers.get("change-eng-2")!.resolve(0);
    await tick();
    expect(ctx.workers.has("change-eng-4")).toBe(true);
    ctx.workers.get("change-eng-4")!.resolve(0);
    await tick();
    expect(ctx.workers.has("change-eng-1")).toBe(true);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
    expect(ctx.workers.has("change-eng-3")).toBe(true);
  });

  test("within a priority/mode bucket, older createdAt drains first (FIFO)", async () => {
    // All same priority + same mode (fresh) → tie broken by createdAt ascending.
    const issues = [
      issue("new", "ENG-3", 3, [], "2026-05-10T00:00:00.000Z"),
      issue("old", "ENG-1", 3, [], "2026-01-01T00:00:00.000Z"),
      issue("mid", "ENG-2", 3, [], "2026-03-01T00:00:00.000Z"),
    ];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.workers.has("change-eng-1")).toBe(true);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
    expect(ctx.workers.has("change-eng-2")).toBe(true);
    ctx.workers.get("change-eng-2")!.resolve(0);
    await tick();
    expect(ctx.workers.has("change-eng-3")).toBe(true);
  });

  test("re-poll dedupes against active and pending", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);

    const r2 = await coord.pollOnce();
    expect(r2.added).toBe(0);
  });

  test("fetch failure logs and returns zero counts", async () => {
    const ctx = makeDeps();
    ctx.deps.fetchTodo = async () => {
      throw new Error("network down");
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.found).toBe(0);
    expect(r.added).toBe(0);
    expect(r.buckets).toEqual({
      todo: 0,
      inProgress: 0,
      conflicted: 0,
      ciFailed: 0,
      review: 0,
      mentions: 0,
      quarantined: 0,
      awaiting: 0,
    });
    expect(ctx.logs.some((l) => l.text.includes("Linear poll failed: network down"))).toBe(true);
  });

  test("stop kills active workers and prevents new spawns", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2")];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);

    coord.stop();
    expect(ctx.workers.get("change-eng-1")!.killed).toBe(true);

    const r = await coord.pollOnce();
    expect(r.found).toBe(0);
    expect(r.added).toBe(0);
  });

  test("getters expose live counts and worker descriptors", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2")];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    expect(coord.activeCount).toBe(0);
    expect(coord.queuedCount).toBe(0);
    expect(coord.activeWorkers).toEqual([]);
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);
    expect(coord.queuedCount).toBe(1);
    expect(coord.activeWorkers).toHaveLength(1);
    expect(coord.activeWorkers[0]!.changeName).toBe("change-eng-1");
  });

  test("blocked issue is skipped while blocker is open in our view", async () => {
    const blocker = issue("blocker", "ENG-1");
    const blocked = issue("blocked", "ENG-2", 3, ["blocker"]);
    const ctx = makeDeps({ todo: [blocker, blocked] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 2 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    // blocker is in flight (active), blocked stays out
    expect(ctx.workers.has("change-eng-1")).toBe(true);
    expect(ctx.workers.has("change-eng-2")).toBe(false);
    expect(ctx.logs.some((l) => l.text.includes("ENG-2") && l.text.includes("blocked"))).toBe(true);
  });

  test("pollOnce returns per-bucket counts for the dashboard", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1"), issue("b", "ENG-2")] });
    ctx.setInProgress([issue("c", "ENG-3")]);
    ctx.setMentions([
      {
        issue: issue("f", "ENG-6"),
        trigger: {
          source: "linear",
          body: "@ralphy please look",
          createdAt: "2026-05-12T00:00:00Z",
        },
      },
    ]);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    const r = await coord.pollOnce();
    await tick();
    expect(r.buckets).toEqual({
      todo: 2,
      inProgress: 1,
      conflicted: 0,
      ciFailed: 0,
      review: 0,
      mentions: 1,
      quarantined: 0,
      awaiting: 0,
    });
    expect(r.found).toBe(4);
  });

  test("awaiting-confirmation in-progress tickets are diverted into buckets.awaiting and never enqueued", async () => {
    const gated = issue("c", "ENG-3");
    const resumable = issue("d", "ENG-4");
    const fresh = issue("e", "ENG-5");
    const ctx = makeDeps({ todo: [fresh] });
    ctx.setInProgress([gated, resumable]);
    ctx.deps.buildFeatureCtx = gatedCtxFactory(new Set(["c"]));

    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    const r = await coord.pollOnce();
    await tick();

    expect(r.buckets).toEqual({
      todo: 1,
      inProgress: 1,
      conflicted: 0,
      ciFailed: 0,
      review: 0,
      mentions: 0,
      quarantined: 0,
      awaiting: 1,
    });
    expect(r.found).toBe(3);

    // concurrency=1 → the resumable in-progress ticket wins the slot.
    // The gated ticket must NOT appear among active workers or in the queue.
    expect(coord.activeCount).toBe(1);
    expect(coord.activeWorkers[0]!.changeName).toBe("change-eng-4");
    expect(ctx.workers.has("change-eng-3")).toBe(false);
    // Fresh todo is queued but not running (concurrency budget consumed).
    expect(coord.queuedCount).toBe(1);
  });

  test("concurrency=1 + gated ticket + fresh Todo: fresh runs, gated never queued or active", async () => {
    const gated = issue("g", "ENG-1");
    const fresh = issue("f", "ENG-2");
    const ctx = makeDeps({ todo: [fresh] });
    ctx.setInProgress([gated]);
    ctx.deps.buildFeatureCtx = gatedCtxFactory(new Set(["g"]));

    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(coord.activeCount).toBe(1);
    expect(coord.activeWorkers[0]!.changeName).toBe("change-eng-2");
    expect(coord.queuedCount).toBe(0);
    expect(ctx.workers.has("change-eng-1")).toBe(false);
  });

  test("reapForAwaiting kills the in-flight worker without finalizing the issue", async () => {
    const setDone: SetIndicator = { type: "label", value: "done" };
    const setError: SetIndicator = { type: "label", value: "error" };
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setDone, setError });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);

    // Drop the "started" comment posted at launch — we only care about
    // what notifyExited would (or shouldn't) add after the reap.
    ctx.applies.length = 0;
    ctx.comments.length = 0;
    ctx.removes.length = 0;

    const reaped = coord.reapForAwaiting("change-eng-1");
    expect(reaped).toBe(true);
    expect(ctx.workers.get("change-eng-1")!.killed).toBe(true);
    await tick();

    // Worker exit handler skipped notifyExited entirely — no setDone /
    // setError / completion comment should have been applied.
    expect(coord.activeCount).toBe(0);
    expect(ctx.applies).toEqual([]);
    expect(ctx.comments).toEqual([]);
    expect(ctx.removes).toEqual([]);
  });

  test("reapForAwaiting flushes a final syncTasks pass so design.md uploads before the gate", async () => {
    // LIT-303 repro: when a worker completes planning inside a single
    // iteration and is reaped for awaiting-confirmation, the only prior
    // syncTasks call fired at spawn (iteration 0) — before design.md
    // existed. Without a post-reap flush, the spec-attachments hook
    // never sees the now-written design.md and no PDF lands on Linear.
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const syncCalls: { changeName: string; iteration: number }[] = [];
    const deps = {
      ...ctx.deps,
      getIterationCount: async (_n: string) => 0,
      syncTasks: async (w: { changeName: string }, iteration: number) => {
        syncCalls.push({ changeName: w.changeName, iteration });
      },
    };
    const coord = new AgentCoordinator(deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);
    // After spawn there is exactly one syncTasks call (iteration 0).
    expect(syncCalls).toEqual([{ changeName: "change-eng-1", iteration: 0 }]);

    expect(coord.reapForAwaiting("change-eng-1")).toBe(true);
    await tick();

    // Post-reap: the exit handler should have invoked syncTasks one more
    // time so spec-attachments + tasks-comment hooks re-run against the
    // now-written design.md / proposal.md.
    expect(syncCalls.length).toBe(2);
    expect(syncCalls[1]!.changeName).toBe("change-eng-1");
  });

  test("reapForAwaiting returns false when no active worker matches", async () => {
    const ctx = makeDeps();
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    expect(coord.reapForAwaiting("unknown")).toBe(false);
  });

  test("isAwaitingConfirmation reflects reap state of an active worker", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.isAwaitingConfirmation("change-eng-1")).toBe(false);
    coord.reapForAwaiting("change-eng-1");
    expect(coord.isAwaitingConfirmation("change-eng-1")).toBe(true);
  });

  test("maxTickets caps how many issues are started this run", async () => {
    const issues = [issue("a", "ENG-1"), issue("b", "ENG-2"), issue("c", "ENG-3")];
    const ctx = makeDeps({ todo: issues });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 3, maxTickets: 2 });
    await coord.init();

    const result = await coord.pollOnce();
    // only 2 should be enqueued, not 3
    expect(result.added).toBe(2);
    await tick();
    expect(coord.activeCount).toBe(2);
    expect(coord.ticketsStartedCount).toBe(2);
    // second poll must not pick up the third issue
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(2);
    expect(coord.ticketsStartedCount).toBe(2);
    // a "ticket limit reached" notice should have been logged
    expect(ctx.logs.some((l) => l.text.includes("ticket limit"))).toBe(true);
  });
});

describe("AgentCoordinator — set/clear indicators", () => {
  test("setInProgress applied BEFORE worker spawns", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const setInProgress: SetIndicator = { type: "status", value: "In Progress" };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setInProgress,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    // applyIndicator (setInProgress) was called for issue 'a'
    expect(ctx.applies).toContainEqual({ id: "a", ind: setInProgress });
    // spawn happened too
    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });

  test("fetchComments failure logs warning and proceeds with the spawn", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    ctx.deps.fetchComments = async () => {
      throw new Error("rate limited");
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.logs.some((l) => l.text.includes("comment fetch failed"))).toBe(true);
    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });

  test("'started' comment is NOT re-posted when an existing one is found", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    ctx.deps.fetchComments = async () => [
      { body: "🤖 Ralph started working on this issue earlier" },
    ];
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.comments.find((c) => c.body.includes("started working"))).toBeUndefined();
  });

  test("setDone applied on clean exit; setError on non-zero", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1"), issue("b", "ENG-2")] });
    const setDone: SetIndicator = { type: "label", value: "shipped" };
    const setError: SetIndicator = { type: "label", value: "ralph:error" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 2, setDone, setError });
    await coord.init();
    await coord.pollOnce();
    await tick();

    ctx.workers.get("change-eng-1")!.resolve(0);
    ctx.workers.get("change-eng-2")!.resolve(2);
    await tick();
    expect(ctx.applies).toContainEqual({ id: "a", ind: setDone });
    expect(ctx.applies).toContainEqual({ id: "b", ind: setError });
    expect(ctx.applies.find((a) => a.id === "a" && a.ind === setError)).toBeUndefined();
  });

  test("multi-marker setDone applies both markers in sequence", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const setDone: SetIndicator = [
      { type: "status", value: "Done" },
      { type: "label", value: "shipped" },
    ];
    // The coordinator passes the SetIndicator to applyIndicator as-is;
    // unpacking is wire's job. So we just observe the call shape.
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setDone });
    await coord.init();
    await coord.pollOnce();
    await tick();
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
    expect(ctx.applies).toContainEqual({ id: "a", ind: setDone });
  });

  test("postComments=false suppresses comments but markers still applied", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const setInProgress: SetIndicator = { type: "status", value: "In Progress" };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setInProgress,
      postComments: false,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.comments).toEqual([]);
    expect(ctx.applies).toContainEqual({ id: "a", ind: setInProgress });
  });
});

describe("AgentCoordinator — resume and conflict-fix", () => {
  test("getInProgress issues route through prepare(resume) and skip setInProgress", async () => {
    const inflight = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setInProgress([inflight]);
    const setInProgress: SetIndicator = { type: "status", value: "In Progress" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setInProgress });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.added).toBe(1);
    await tick();
    expect(ctx.workers.has("change-eng-1")).toBe(true);
    // resume mode → setInProgress NOT applied (already in progress)
    expect(ctx.applies.find((a) => a.id === "a")).toBeUndefined();
  });

  test("done-candidate with CONFLICTING PR routes through prepare(conflict-fix)", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const observed: QueueTrigger[] = [];
    ctx.deps.prepare = async (i) => ({ changeName: `change-${i.identifier.toLowerCase()}` });
    ctx.deps.prepareTaskForTrigger = async (_i, _name, trigger) => {
      observed.push(trigger);
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(observed).toContain("conflict-fix");
  });

  test("@ralphy mention queues review with the trigger forwarded to prepare", async () => {
    const issueA = issue("a", "ENG-1");
    const ctx = makeDeps();
    const trigger: MentionTrigger = {
      source: "github",
      body: "@ralphy please refactor the parser",
      createdAt: "2026-05-12T10:00:00Z",
      author: "reviewer-1",
      url: "https://github.com/o/r/pull/1#issuecomment-123",
    };
    ctx.setMentions([{ issue: issueA, trigger }]);
    const seen: { trigger: QueueTrigger; mention?: MentionTrigger }[] = [];
    ctx.deps.prepare = async (i) => ({ changeName: `change-${i.identifier.toLowerCase()}` });
    ctx.deps.prepareTaskForTrigger = async (_i, _name, t, m) => {
      seen.push({ trigger: t, ...(m ? { mention: m } : {}) });
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(seen).toContainEqual({ trigger: "review", mention: trigger });
    expect(
      ctx.comments.some((c) => c.body.includes("GitHub @mention") && c.body.includes("picked up")),
    ).toBe(true);
  });

  test("github-review trigger annotates the pickup comment with Code review", async () => {
    const issueA = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setMentions([
      {
        issue: issueA,
        trigger: {
          source: "github-review",
          body: "_src/foo.ts:42_\n\n> **reviewer** (2026-05-12T09:00:00Z)\n>\n> rename this",
          createdAt: "2026-05-12T09:00:00Z",
          author: "reviewer-1",
          url: "https://github.com/o/r/pull/1",
        },
      },
    ]);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.comments.some((c) => c.body.includes("GitHub code review"))).toBe(true);
  });

  test("@ralphy mention from Linear annotates the pickup comment with Linear @mention", async () => {
    const issueA = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setMentions([
      {
        issue: issueA,
        trigger: {
          source: "linear",
          body: "@ralphy can you add tests",
          createdAt: "2026-05-12T11:00:00Z",
        },
      },
    ]);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.comments.some((c) => c.body.includes("Linear @mention"))).toBe(true);
  });

  test("review (mention) success re-applies setDone (treated like fresh-mode completion)", async () => {
    const reviewIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setMentions([
      {
        issue: reviewIssue,
        trigger: {
          source: "linear",
          body: "@ralphy please review",
          createdAt: "2026-05-12T00:00:00Z",
        },
      },
    ]);
    const setDone: SetIndicator = { type: "status", value: "Done" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setDone });
    await coord.init();
    await coord.pollOnce();
    await tick();
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
    expect(ctx.applies.find((a) => a.id === "a" && a.ind === setDone)).toBeDefined();
  });

  test("conflict-fix success skips setDone (state re-checked from GitHub next poll)", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const setDone: SetIndicator = { type: "status", value: "Done" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setDone });
    await coord.init();
    await coord.pollOnce();
    await tick();
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();

    expect(ctx.applies.find((a) => a.id === "a" && a.ind === setDone)).toBeUndefined();
  });
});

describe("AgentCoordinator — gh-driven merge-state scan", () => {
  test("done-candidate with CONFLICTING PR queues conflict-fix and spawns worker", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.comments.some((c) => c.id === "a" && c.body.includes("merge conflicts"))).toBe(true);
    expect(ctx.workers.has("change-eng-1")).toBe(true);
    // No Linear label applied — gh is the source of truth now.
    expect(ctx.applies.find((a) => a.id === "a")).toBeUndefined();
  });

  test("merge-state scan does not re-notify on subsequent polls (in-memory dedup)", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    const firstComments = ctx.comments.length;

    await coord.pollOnce();
    await tick();
    expect(ctx.comments.length).toBe(firstComments);
  });

  test("ci_failed PR on done candidate is queued as ci-fix", async () => {
    const ticket = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([ticket]);
    ctx.conflictByIssue.set("a", {
      url: "https://github.com/o/r/pull/501",
      status: "ci_failed" as const,
    });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.prStatus).toEqual({ mergeable: 0, conflicted: 0, ciFailed: 1, quarantined: 0 });
    expect(r.buckets.ciFailed).toBe(1);
    expect(ctx.comments.some((c) => c.id === "a" && c.body.includes("failing CI"))).toBe(true);
    expect(coord.queuedCount).toBe(1);
  });

  test("pollOnce aggregates PR status counts across done candidates", async () => {
    const ctx = makeDeps();
    ctx.setDoneCandidates([
      issue("a", "ENG-1"),
      issue("b", "ENG-2"),
      issue("c", "ENG-3"),
      issue("d", "ENG-4"),
    ]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "mergeable" as const });
    ctx.conflictByIssue.set("b", { url: "https://gh/pr/2", status: "mergeable" as const });
    ctx.conflictByIssue.set("c", { url: "https://gh/pr/3", status: "conflicted" as const });
    ctx.conflictByIssue.set("d", { url: "https://gh/pr/4", status: "ci_failed" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.prStatus).toEqual({ mergeable: 2, conflicted: 1, ciFailed: 1, quarantined: 0 });
    expect(r.buckets.conflicted).toBe(1);
    expect(r.buckets.ciFailed).toBe(1);
  });

  test("bailed conflicting PR is surfaced as quarantined, not conflicted, and not re-queued", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prtracker-q-"));
    const tracker = new PrTracker({ projectRoot: dir, maxRecoveryAttempts: 1 });
    const setError: SetIndicator = { type: "label", value: "error" };
    const ctx = makeDeps();
    const tk = issue("a", "ENG-1");
    tk.labels = ["error"]; // quarantine label still on the ticket
    ctx.setDoneCandidates([tk]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0, prTracker: tracker, setError });
    await coord.init();

    // Poll 1: first failure tips it over maxRecoveryAttempts=1 → bail → quarantined.
    const r1 = await coord.pollOnce();
    expect(r1.prStatus.quarantined).toBe(1);
    expect(r1.prStatus.conflicted).toBe(0);
    expect(coord.queuedCount).toBe(0);

    // Poll 2: still bailed + label present → stays quarantined, never re-queued.
    const r2 = await coord.pollOnce();
    expect(r2.prStatus.quarantined).toBe(1);
    expect(r2.prStatus.conflicted).toBe(0);
    expect(coord.queuedCount).toBe(0);
  });

  test("clearing the setError label releases a bail and re-queues conflict-fix", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prtracker-r-"));
    const tracker = new PrTracker({ projectRoot: dir, maxRecoveryAttempts: 3 });
    // Pre-seed a bail (3 failures → bailed).
    await tracker.recordFailure("ENG-1", "conflicting");
    await tracker.recordFailure("ENG-1", "conflicting");
    await tracker.recordFailure("ENG-1", "conflicting");
    expect(tracker.isBailed("ENG-1")).toBe(true);

    const setError: SetIndicator = { type: "label", value: "error" };
    const ctx = makeDeps();
    const tk = issue("a", "ENG-1");
    tk.labels = []; // human cleared the quarantine label → retry intent
    ctx.setDoneCandidates([tk]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0, prTracker: tracker, setError });
    await coord.init();

    const r = await coord.pollOnce();
    expect(tracker.isBailed("ENG-1")).toBe(false); // bail released
    expect(r.prStatus.conflicted).toBe(1); // re-detected as a standing conflict
    expect(r.prStatus.quarantined).toBe(0);
    expect(coord.queuedCount).toBe(1); // conflict-fix re-queued
  });

  test("conflicted count is a standing level — survives across polls without re-detection", async () => {
    const ctx = makeDeps();
    const tk = issue("a", "ENG-1");
    ctx.setDoneCandidates([tk]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    // concurrency 0 so the queued conflict-fix never drains.
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0 });
    await coord.init();

    const r1 = await coord.pollOnce();
    expect(r1.prStatus.conflicted).toBe(1);
    // Second poll: already notified + queued. Must STILL report 1 (not a delta-0).
    const r2 = await coord.pollOnce();
    expect(r2.prStatus.conflicted).toBe(1);
  });

  test("in-progress ticket with CONFLICTING PR is promoted, not resumed", async () => {
    const inProgressIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setInProgress([inProgressIssue]);
    ctx.conflictByIssue.set("a", {
      url: "https://github.com/o/r/pull/376",
      status: "conflicted" as const,
    });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(
      ctx.comments.filter(
        (c) =>
          c.id === "a" &&
          c.body.includes("PR #376") &&
          c.body.includes("promoted to conflict-fix flow"),
      ).length,
    ).toBe(1);
    // Worker spawned via conflict-fix queue entry, not resume.
    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });

  test("in-progress ticket with CI-failed PR is promoted to ci-fix", async () => {
    const inProgressIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setInProgress([inProgressIssue]);
    ctx.conflictByIssue.set("a", {
      url: "https://github.com/o/r/pull/400",
      status: "ci_failed" as const,
    });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(
      ctx.comments.filter(
        (c) => c.id === "a" && c.body.includes("failing CI") && c.body.includes("ci-fix"),
      ).length,
    ).toBe(1);
    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });

  test("promotion is idempotent across polls (one comment)", async () => {
    const inProgressIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setInProgress([inProgressIssue]);
    ctx.conflictByIssue.set("a", {
      url: "https://github.com/o/r/pull/376",
      status: "conflicted" as const,
    });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    await coord.pollOnce();
    await tick();

    expect(
      ctx.comments.filter((c) => c.id === "a" && c.body.includes("promoted to conflict-fix"))
        .length,
    ).toBe(1);
  });

  test("MERGEABLE in-progress ticket still resumes (no regression)", async () => {
    const inProgressIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setInProgress([inProgressIssue]);
    ctx.conflictByIssue.set("a", {
      url: "https://github.com/o/r/pull/1",
      status: "mergeable" as const,
    });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });
});

describe("AgentCoordinator — progress comments", () => {
  test("posts a progress comment on each new iteration milestone", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    let count = 0;
    ctx.deps.getIterationCount = async () => count;
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      commentEveryIterations: 10,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    const progressCount = () => ctx.comments.filter((c) => c.body.includes("progress")).length;

    expect(progressCount()).toBe(0);

    count = 7;
    await coord.pollOnce();
    expect(progressCount()).toBe(0);

    count = 10;
    await coord.pollOnce();
    expect(ctx.comments.some((c) => c.body.includes("iteration 10"))).toBe(true);

    count = 14;
    await coord.pollOnce();
    expect(progressCount()).toBe(1);

    count = 22;
    await coord.pollOnce();
    expect(ctx.comments.some((c) => c.body.includes("iteration 22"))).toBe(true);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("commentEveryIterations=0 disables progress comments", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    ctx.deps.getIterationCount = async () => 99;
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      commentEveryIterations: 0,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    await coord.pollOnce();
    expect(ctx.comments.filter((c) => c.body.includes("progress"))).toEqual([]);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("auto-merge conflict-fix runs ahead of urgent todos (boost bucket)", async () => {
    const conflict = issue("c1", "ENG-9", 0);
    conflict.labels = ["ralph:auto-merge"];
    const urgent1 = issue("t1", "ENG-1", 1);
    const urgent2 = issue("t2", "ENG-2", 1);
    const ctx = makeDeps();
    ctx.setTodo([urgent1, urgent2]);
    ctx.setDoneCandidates([conflict]);
    ctx.conflictByIssue.set("c1", { url: "https://gh/pr/9", status: "conflicted" as const });

    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      getAutoMerge: { filter: [{ type: "label", value: "ralph:auto-merge" }] },
    });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-9")).toBe(true);
    expect(ctx.workers.has("change-eng-1")).toBe(false);
    ctx.workers.get("change-eng-9")!.resolve(0);
    await tick();
  });

  test("two auto-merge conflicts compete by linear priority", async () => {
    const highPri = issue("c1", "ENG-9", 1);
    highPri.labels = ["ralph:auto-merge"];
    const lowPri = issue("c2", "ENG-8", 3);
    lowPri.labels = ["ralph:auto-merge"];
    const ctx = makeDeps();
    ctx.setDoneCandidates([lowPri, highPri]);
    ctx.conflictByIssue.set("c1", { url: "https://gh/pr/9", status: "conflicted" as const });
    ctx.conflictByIssue.set("c2", { url: "https://gh/pr/8", status: "conflicted" as const });

    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      getAutoMerge: { filter: [{ type: "label", value: "ralph:auto-merge" }] },
    });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-9")).toBe(true);
    expect(ctx.workers.has("change-eng-8")).toBe(false);
    ctx.workers.get("change-eng-9")!.resolve(0);
    await tick();
  });

  test("non-auto-merge ordering is unchanged when indicator is absent", async () => {
    const conflict = issue("c1", "ENG-9", 0);
    conflict.labels = ["ralph:auto-merge"];
    const urgent = issue("t1", "ENG-1", 1);
    const ctx = makeDeps();
    ctx.setTodo([urgent]);
    ctx.setDoneCandidates([conflict]);
    ctx.conflictByIssue.set("c1", { url: "https://gh/pr/9", status: "conflicted" as const });

    // No getAutoMerge option → existing priority-only sort wins; urgent todo
    // beats a no-priority conflict-fix.
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-1")).toBe(true);
    expect(ctx.workers.has("change-eng-9")).toBe(false);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("pause gate blocks new pickups and clears on resume", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();

    expect(coord.isPaused()).toBe(false);
    coord.setPaused({
      issueIdentifier: "RLF-99",
      command: "bun run lint",
      fingerprint: "abc",
      since: Date.now(),
    });
    expect(coord.isPaused()).toBe(true);

    const r = await coord.pollOnce();
    expect(r.added).toBe(0);
    expect(coord.activeCount).toBe(0);
    expect(coord.queuedCount).toBe(0);

    coord.clearPaused();
    expect(coord.isPaused()).toBe(false);
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("pause does not affect already in-flight workers", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);

    coord.setPaused({
      issueIdentifier: "RLF-99",
      command: "x",
      fingerprint: "abc",
      since: Date.now(),
    });
    // In-flight worker is undisturbed.
    expect(coord.activeCount).toBe(1);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("getIterationCount failure logs warning and continues", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    ctx.deps.getIterationCount = async () => {
      throw new Error("disk read failed");
    };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      commentEveryIterations: 10,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    await coord.pollOnce();
    expect(ctx.logs.some((l) => l.text.includes("iteration count read failed"))).toBe(true);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });
});

describe("AgentCoordinator — task sync on every poll", () => {
  test("with postComments:false, syncTasks fires every poll as iteration advances and no progress comment posted", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    let count = 0;
    ctx.deps.getIterationCount = async () => count;
    const syncCalls: { changeName: string; iteration: number }[] = [];
    ctx.deps.syncTasks = async (w, iteration) => {
      syncCalls.push({ changeName: w.changeName, iteration });
    };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      commentEveryIterations: 10,
      postComments: false,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    // launch sync (iteration 0)
    expect(syncCalls).toEqual([{ changeName: "change-eng-1", iteration: 0 }]);

    count = 3;
    await coord.pollOnce();
    expect(syncCalls).toContainEqual({ changeName: "change-eng-1", iteration: 3 });

    count = 5;
    await coord.pollOnce();
    expect(syncCalls).toContainEqual({ changeName: "change-eng-1", iteration: 5 });

    // No progress comment posted.
    expect(ctx.comments.filter((c) => c.body.includes("progress"))).toEqual([]);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("with commentEveryIterations:0, syncTasks still fires every poll but no progress comment posted", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    let count = 0;
    ctx.deps.getIterationCount = async () => count;
    const syncCalls: number[] = [];
    ctx.deps.syncTasks = async (_w, iteration) => {
      syncCalls.push(iteration);
    };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      commentEveryIterations: 0,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(syncCalls).toEqual([0]);

    count = 2;
    await coord.pollOnce();
    expect(syncCalls).toEqual([0, 2]);

    count = 4;
    await coord.pollOnce();
    expect(syncCalls).toEqual([0, 2, 4]);

    expect(ctx.comments.filter((c) => c.body.includes("progress"))).toEqual([]);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("syncTasks is NOT re-invoked when iteration count is unchanged between polls", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    ctx.deps.getIterationCount = async () => 0;
    const syncCalls: number[] = [];
    ctx.deps.syncTasks = async (_w, iteration) => {
      syncCalls.push(iteration);
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    // launch syncs iteration 0; poll-loop sync sees count===lastSynced and skips.
    expect(syncCalls).toEqual([0]);

    await coord.pollOnce();
    await coord.pollOnce();
    expect(syncCalls).toEqual([0]);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("when syncTasks throws, lastSyncedIteration is not advanced and the next poll retries with the same count", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    let count = 0;
    ctx.deps.getIterationCount = async () => count;
    const seen: number[] = [];
    ctx.deps.syncTasks = async (_w, iteration) => {
      seen.push(iteration);
      if (iteration === 5) throw new Error("upload failed");
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(seen).toEqual([0]);

    count = 5;
    await coord.pollOnce();
    // attempted but threw — lastSyncedIteration stays 0
    expect(seen).toEqual([0, 5]);
    expect(ctx.logs.some((l) => l.text.includes("sync-tasks (poll) failed"))).toBe(true);

    // count still 5 — retry should fire again because lastSyncedIteration didn't advance.
    await coord.pollOnce();
    expect(seen).toEqual([0, 5, 5]);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });
});

describe("AgentCoordinator — poll summary log routing", () => {
  test("poll summary goes to onFileLog, not onLog", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    const pollLines = ctx.fileLogs.filter((t) => t.includes("poll:"));
    expect(pollLines.length).toBe(1);
    expect(pollLines[0]).toContain("1 todo");
    expect(pollLines[0]).toContain("0 in-progress");
    expect(ctx.logs.some((l) => l.text.startsWith("  poll:"))).toBe(false);

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("empty poll emits no summary line on either channel", async () => {
    const ctx = makeDeps();
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();

    expect(ctx.fileLogs.some((t) => t.includes("poll:"))).toBe(false);
    expect(ctx.logs.some((l) => l.text.includes("poll:"))).toBe(false);
  });

  test("missing onFileLog is a silent no-op for poll summary", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    delete (ctx.deps as { onFileLog?: unknown }).onFileLog;
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.logs.some((l) => l.text.startsWith("  poll:"))).toBe(false);
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });
});

describe("AgentCoordinator — flow machine actor state", () => {
  test("flow value for a fresh issue reflects 'working' (actor dispatched FRESH_PICKED_UP)", async () => {
    const ctx = makeDeps({ todo: [issue("a", "ENG-1")] });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    // Worker is active; flow should read from actor state which is "working"
    const result2 = await coord.pollOnce();
    expect(result2.flow["change-eng-1"]).toBe("working");

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("flow value for a conflict-fix issue reflects 'conflict-fix' from actor state", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    // Second poll: worker is active, actor state is "conflict-fix"
    const result2 = await coord.pollOnce();
    expect(result2.flow["change-eng-1"]).toBe("conflict-fix");

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("flow value for a ci-fix issue reflects 'ci-fix' from actor state", async () => {
    const ticket = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([ticket]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "ci_failed" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    const result2 = await coord.pollOnce();
    expect(result2.flow["change-eng-1"]).toBe("ci-fix");

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("flow value for a review issue reflects 'review' from actor state", async () => {
    const issueA = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setMentions([
      {
        issue: issueA,
        trigger: { source: "linear", body: "@ralphy review", createdAt: "2026-01-01T00:00:00Z" },
      },
    ]);
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();

    const result2 = await coord.pollOnce();
    expect(result2.flow["change-eng-1"]).toBe("review");

    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
  });

  test("process restart: actor rehydrates from persisted snapshot and produces correct trigger", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const tmpDir = await mkdtemp(join(tmpdir(), "coord-restart-test-"));
    try {
      const issueA = issue("a", "ENG-1");

      function makeDepsWithChangeDir(
        initial: { todo?: LinearIssue[] } = {},
      ): ReturnType<typeof makeDeps> & { tmpDir: string } {
        const d = makeDeps(initial);
        d.deps.getChangeDir = (_i: LinearIssue) => tmpDir;
        return { ...d, tmpDir };
      }

      // First coordinator: issue picked up as fresh, actor transitions to "working"
      const ctx1 = makeDepsWithChangeDir({ todo: [issueA] });
      const coord1 = new AgentCoordinator(ctx1.deps, { concurrency: 1 });
      await coord1.init();
      await coord1.pollOnce();
      await tick();
      // Actor snapshot persisted to tmpDir at this point

      // Simulate restart: create a fresh coordinator with the same getChangeDir
      const ctx2 = makeDepsWithChangeDir();
      ctx2.setInProgress([issueA]);
      const coord2 = new AgentCoordinator(ctx2.deps, { concurrency: 1 });
      await coord2.init();
      await coord2.pollOnce();
      await tick();

      // The second coordinator should rehydrate the actor (already in "working") and
      // RESUME_DETECTED should be ignored (already working). The trigger should still be "resume".
      expect(ctx2.workers.has("change-eng-1")).toBe(true);

      // Flow should show "working" (rehydrated state)
      const result3 = await coord2.pollOnce();
      expect(result3.flow["change-eng-1"]).toBe("working");

      ctx2.workers.get("change-eng-1")!.resolve(0);
      await tick();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
