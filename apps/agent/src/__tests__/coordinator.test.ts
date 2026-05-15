import { describe, expect, test, mock } from "bun:test";
import {
  AgentCoordinator,
  type CoordinatorDeps,
  type SpawnMode,
  type MentionTrigger,
} from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import type { SetIndicator } from "@ralphy/types";

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
    labels: [],
    priority,
    blockedByIds,
    createdAt,
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
  applies: { id: string; ind: SetIndicator }[];
  removes: { id: string; ind: SetIndicator }[];
  comments: { id: string; body: string }[];
  conflictByIssue: Map<
    string,
    { url: string; status: "mergeable" | "conflicted" | "ci_failed" | "unknown" } | null
  >;
  /** Update what fetchTodo returns on the next call. */
  setTodo: (issues: LinearIssue[]) => void;
  setInProgress: (issues: LinearIssue[]) => void;
  setConflicted: (issues: LinearIssue[]) => void;
  setReview: (issues: LinearIssue[]) => void;
  setMentions: (mentions: { issue: LinearIssue; trigger: MentionTrigger }[]) => void;
  setDoneCandidates: (issues: LinearIssue[]) => void;
}

function makeDeps(initial: { todo?: LinearIssue[] } = {}): DepsResult {
  const workers = new Map<string, FakeWorker>();
  const logs: { text: string; color?: string }[] = [];
  const applies: { id: string; ind: SetIndicator }[] = [];
  const removes: { id: string; ind: SetIndicator }[] = [];
  const comments: { id: string; body: string }[] = [];
  const conflictByIssue = new Map<
    string,
    { url: string; status: "mergeable" | "conflicted" | "ci_failed" | "unknown" } | null
  >();

  let todo: LinearIssue[] = initial.todo ?? [];
  let inProgress: LinearIssue[] = [];
  let conflicted: LinearIssue[] = [];
  let review: LinearIssue[] = [];
  let mentions: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
  let doneCandidates: LinearIssue[] = [];

  const deps: CoordinatorDeps = {
    fetchTodo: mock(async () => todo),
    fetchInProgress: mock(async () => inProgress),
    fetchConflicted: mock(async () => conflicted),
    fetchReview: mock(async () => review),
    fetchMentions: mock(async () => mentions),
    fetchDoneCandidates: mock(async () => doneCandidates),
    prepare: mock(async (i: LinearIssue, _mode: SpawnMode, _trigger?: MentionTrigger) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
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
    onLog: (text, color) => {
      logs.push(color !== undefined ? { text, color } : { text });
    },
    onWorkersChanged: () => {},
  };

  return {
    deps,
    workers,
    logs,
    applies,
    removes,
    comments,
    conflictByIssue,
    setTodo: (xs) => {
      todo = xs;
    },
    setInProgress: (xs) => {
      inProgress = xs;
    },
    setConflicted: (xs) => {
      conflicted = xs;
    },
    setReview: (xs) => {
      review = xs;
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
    expect(r.buckets).toEqual({ todo: 0, inProgress: 0, conflicted: 0, review: 0, mentions: 0 });
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
    ctx.setConflicted([issue("d", "ENG-4")]);
    ctx.setReview([issue("e", "ENG-5")]);
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
      conflicted: 1,
      review: 1,
      mentions: 1,
    });
    expect(r.found).toBe(6);
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

  test("getConflicted issues route through prepare(conflict-fix)", async () => {
    const conflictedIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setConflicted([conflictedIssue]);
    const observed: SpawnMode[] = [];
    ctx.deps.prepare = async (i, mode) => {
      observed.push(mode);
      return { changeName: `change-${i.identifier.toLowerCase()}` };
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(observed).toContain("conflict-fix");
  });

  test("getReview issues route through prepare(review) and clearReview is applied", async () => {
    const reviewIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setReview([reviewIssue]);
    const observed: SpawnMode[] = [];
    ctx.deps.prepare = async (i, mode) => {
      observed.push(mode);
      return { changeName: `change-${i.identifier.toLowerCase()}` };
    };
    const clearReview: SetIndicator = { type: "label", value: "ralph:review" };
    const setInProgress: SetIndicator = { type: "status", value: "In Progress" };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setInProgress,
      clearReview,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(observed).toContain("review");
    // setInProgress applied (review pulls a done issue back into progress)
    expect(ctx.applies).toContainEqual({ id: "a", ind: setInProgress });
    // clearReview removed so the same trigger doesn't re-fire next poll
    expect(ctx.removes).toContainEqual({ id: "a", ind: clearReview });
    // review pickup comment posted
    expect(ctx.comments.some((c) => c.body.includes("review comments"))).toBe(true);
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
    const seen: { mode: SpawnMode; trigger?: MentionTrigger }[] = [];
    ctx.deps.prepare = async (i, mode, t) => {
      seen.push({ mode, ...(t ? { trigger: t } : {}) });
      return { changeName: `change-${i.identifier.toLowerCase()}` };
    };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(seen).toContainEqual({ mode: "review", trigger });
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

  test("review success re-applies setDone (treated like fresh-mode completion)", async () => {
    const reviewIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setReview([reviewIssue]);
    const setDone: SetIndicator = { type: "status", value: "Done" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setDone });
    await coord.init();
    await coord.pollOnce();
    await tick();
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();
    expect(ctx.applies.find((a) => a.id === "a" && a.ind === setDone)).toBeDefined();
  });

  test("conflict-fix success applies clearConflicted and skips setDone", async () => {
    const conflictedIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setConflicted([conflictedIssue]);
    const setDone: SetIndicator = { type: "status", value: "Done" };
    const clearConflicted: SetIndicator = { type: "label", value: "ralph:conflicted" };
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setDone,
      clearConflicted,
    });
    await coord.init();
    await coord.pollOnce();
    await tick();
    ctx.workers.get("change-eng-1")!.resolve(0);
    await tick();

    expect(ctx.applies.find((a) => a.id === "a" && a.ind === setDone)).toBeUndefined();
    expect(ctx.removes).toContainEqual({ id: "a", ind: clearConflicted });
  });
});

describe("AgentCoordinator — conflict scan", () => {
  test("scans setDone candidates and respawns on CONFLICTING PR", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const setConflicted: SetIndicator = { type: "label", value: "ralph:conflicted" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setConflicted });
    await coord.init();
    await coord.pollOnce();
    await tick();

    // setConflicted applied, comment posted, worker spawned for issue
    expect(ctx.applies).toContainEqual({ id: "a", ind: setConflicted });
    expect(ctx.comments.some((c) => c.id === "a" && c.body.includes("merge conflicts"))).toBe(true);
    expect(ctx.workers.has("change-eng-1")).toBe(true);
  });

  test("conflict scan does not re-notify on subsequent polls", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const setConflicted: SetIndicator = { type: "label", value: "ralph:conflicted" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1, setConflicted });
    await coord.init();
    await coord.pollOnce();
    await tick();

    const firstApplies = ctx.applies.length;
    const firstComments = ctx.comments.length;

    await coord.pollOnce();
    await tick();
    expect(ctx.applies.length).toBe(firstApplies);
    expect(ctx.comments.length).toBe(firstComments);
  });

  test("conflict scan with no setConflicted indicator is a no-op", async () => {
    const doneIssue = issue("a", "ENG-1");
    const ctx = makeDeps();
    ctx.setDoneCandidates([doneIssue]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "conflicted" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 }); // no setConflicted
    await coord.init();
    await coord.pollOnce();
    await tick();
    expect(ctx.applies).toEqual([]);
    expect(ctx.comments).toEqual([]);
    expect(ctx.workers.size).toBe(0);
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
    const setConflicted: SetIndicator = { type: "label", value: "ralph:conflicted" };
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 0, setConflicted });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.prStatus).toEqual({ mergeable: 2, conflicted: 1, ciFailed: 1 });
  });

  test("pollOnce returns zero PR status counts when conflict scan disabled", async () => {
    const ctx = makeDeps();
    ctx.setDoneCandidates([issue("a", "ENG-1")]);
    ctx.conflictByIssue.set("a", { url: "https://gh/pr/1", status: "mergeable" as const });
    const coord = new AgentCoordinator(ctx.deps, { concurrency: 1 });
    await coord.init();
    const r = await coord.pollOnce();
    expect(r.prStatus).toEqual({ mergeable: 0, conflicted: 0, ciFailed: 0 });
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
    ctx.setConflicted([conflict]);

    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      getAutoMerge: { filter: [{ type: "label", value: "ralph:auto-merge" }] },
    });
    await coord.init();
    await coord.pollOnce();
    await tick();

    expect(ctx.workers.has("change-eng-9")).toBe(true);
    expect(ctx.workers.has("change-eng-1")).toBe(false);
    expect(
      ctx.logs.some((l) => l.text.includes("ENG-9 queued (auto-merge unblock, prioritized)")),
    ).toBe(true);
    ctx.workers.get("change-eng-9")!.resolve(0);
    await tick();
  });

  test("two auto-merge conflicts compete by linear priority", async () => {
    const highPri = issue("c1", "ENG-9", 1);
    highPri.labels = ["ralph:auto-merge"];
    const lowPri = issue("c2", "ENG-8", 3);
    lowPri.labels = ["ralph:auto-merge"];
    const ctx = makeDeps();
    ctx.setConflicted([lowPri, highPri]);

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
    ctx.setConflicted([conflict]);

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
