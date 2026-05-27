/**
 * Integration tests for Runtime signals — S6.1–S6.9 (excl. S6.5).
 *
 * S6.1 and S6.2 are already covered by shutdown.test.ts (graceful SIGINT path
 * and double-SIGINT force-exit). This file covers the remaining deterministic
 * scenarios from TEST_MATRIX.md section 6.
 */
import { describe, expect, it } from "bun:test";
import { createBus } from "@ralphy/events";
import type { RalphEvent } from "@ralphy/events";
import { installShutdown } from "../shutdown";
import { AgentCoordinator } from "../coordinator";
import type { LinearIssue } from "../../shared/capabilities/linear-client";

// ─── helpers ────────────────────────────────────────────────────────────────

interface FakeProc {
  on: (sig: string, h: () => void) => void;
  off: (sig: string, h: () => void) => void;
  exit: (code: number) => void;
  fire: (sig: string) => void;
  exitCodes: number[];
}

function makeProc(): FakeProc {
  const handlers = new Map<string, Set<() => void>>();
  const exitCodes: number[] = [];
  return {
    on: (sig, h) => {
      if (!handlers.has(sig)) handlers.set(sig, new Set());
      handlers.get(sig)!.add(h);
    },
    off: (sig, h) => handlers.get(sig)?.delete(h),
    exit: (code) => exitCodes.push(code),
    fire: (sig) => {
      for (const h of handlers.get(sig) ?? []) h();
    },
    exitCodes,
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 5));
}

function makeIssue(id: string): LinearIssue {
  return {
    id,
    identifier: `RLF-${id.toUpperCase()}`,
    title: `Issue ${id}`,
    description: null,
    url: `https://linear.app/test/${id}`,
    state: { name: "Todo", type: "unstarted" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: new Date().toISOString(),
    blockedByIds: [],
  };
}

interface FakeHandle {
  exited: Promise<number>;
  kill: () => void;
  resolve: (code: number) => void;
}

function makeHandle(): FakeHandle {
  let resolve!: (code: number) => void;
  const exited = new Promise<number>((r) => {
    resolve = r;
  });
  return { exited, kill: () => resolve(0), resolve };
}

interface CoordFixture {
  coord: AgentCoordinator;
  handles: FakeHandle[];
  spawned: string[];
}

function makeCoord(
  opts: { concurrency: number; maxTickets?: number },
  todo: LinearIssue[],
): CoordFixture {
  const handles: FakeHandle[] = [];
  const spawned: string[] = [];
  const coord = new AgentCoordinator(
    {
      fetchTodo: async () => todo,
      fetchInProgress: async () => [],
      fetchReview: async () => [],
      fetchMentions: async () => [],
      fetchDoneCandidates: async () => [],
      fetchComments: async () => [],
      prepare: async (issue) => ({ changeName: issue.id }),
      spawnWorker: (_name, issue) => {
        spawned.push(issue.id);
        const h = makeHandle();
        handles.push(h);
        return h;
      },
      applyIndicator: async () => {},
      removeIndicator: async () => {},
      postComment: async () => {},
      checkPrStatus: async () => null,
      onLog: () => {},
      onWorkersChanged: () => {},
    },
    opts,
  );
  return { coord, handles, spawned };
}

// ─── S6.3 — SIGTERM treated identically to SIGINT ───────────────────────────

describe("S6.3 — SIGTERM triggers same graceful path as SIGINT", () => {
  it("single SIGTERM: full shutdown trace, exit 0", async () => {
    const proc = makeProc();
    const bus = createBus();
    const events: RalphEvent[] = [];
    bus.on("*", (e) => events.push(e));

    installShutdown({
      proc,
      bus,
      runtime: {
        stop: () => {},
        activeFlows: () => [{ flowId: "impl", teardown: async () => {} }],
      },
      budgetMs: 200,
    });

    proc.fire("SIGTERM");
    await flush();

    expect(proc.exitCodes).toEqual([0]);
    const types = events.map((e) => e.type);
    expect(types).toContain("runtime.shutdown.started");
    expect(types).toContain("runtime.shutdown.teardown.impl");
    expect(types).toContain("runtime.shutdown.completed");
  });

  it("second SIGTERM while shutdown in progress forces exit 130", async () => {
    const proc = makeProc();
    const bus = createBus();

    installShutdown({
      proc,
      bus,
      runtime: {
        stop: () => {},
        activeFlows: () => [
          { flowId: "slow", teardown: () => new Promise<void>((r) => setTimeout(r, 5000)) },
        ],
      },
      budgetMs: 5000,
    });

    proc.fire("SIGTERM");
    proc.fire("SIGTERM");
    await flush();

    expect(proc.exitCodes[0]).toBe(130);
  });
});

// ─── S6.4 — maxTickets=0 is unlimited ───────────────────────────────────────

describe("S6.4 — maxTickets=0 means unlimited", () => {
  it("picks up all issues when maxTickets is 0", async () => {
    const issues = [makeIssue("a"), makeIssue("b"), makeIssue("c")];
    const { coord, spawned } = makeCoord({ concurrency: 3, maxTickets: 0 }, issues);
    await coord.pollOnce();
    await flush();
    expect(spawned).toHaveLength(3);
    expect(coord.ticketsStartedCount).toBe(3);
  });

  it("picks up all issues when maxTickets is omitted", async () => {
    const issues = [makeIssue("x"), makeIssue("y")];
    const { coord, spawned } = makeCoord({ concurrency: 2 }, issues);
    await coord.pollOnce();
    await flush();
    expect(spawned).toHaveLength(2);
  });
});

// ─── S6.6 — max-tickets accounting after preemption ─────────────────────────

describe("S6.6 — preemption does not permanently consume the ticket cap", () => {
  it("restarted worker decrements ticketsStarted; resume re-increments it to 1", async () => {
    const issues = [makeIssue("p")];
    const { coord, handles } = makeCoord({ concurrency: 1, maxTickets: 1 }, issues);

    await coord.pollOnce();
    await flush();
    expect(coord.ticketsStartedCount).toBe(1);

    const restarted = await coord.restartWorker("p");
    expect(restarted).toBe(true);

    handles[0]!.resolve(0);
    await flush();

    // After restart+resume cycle the count is back to 1 (same ticket, not 2).
    expect(coord.ticketsStartedCount).toBe(1);
  });
});

// ─── S6.7 — poll-while-shutting-down ────────────────────────────────────────

describe("S6.7 — no new workers spawned after stop()", () => {
  it("pollOnce returns empty result without fetching Linear when stopped before poll", async () => {
    let fetched = false;
    const coord = new AgentCoordinator(
      {
        fetchTodo: async () => {
          fetched = true;
          return [makeIssue("q")];
        },
        fetchInProgress: async () => [],
        fetchReview: async () => [],
        fetchMentions: async () => [],
        fetchDoneCandidates: async () => [],
        fetchComments: async () => [],
        prepare: async (issue) => ({ changeName: issue.id }),
        spawnWorker: () => makeHandle(),
        applyIndicator: async () => {},
        removeIndicator: async () => {},
        postComment: async () => {},
        checkPrStatus: async () => null,
        onLog: () => {},
        onWorkersChanged: () => {},
      },
      { concurrency: 1 },
    );

    coord.stop();
    const result = await coord.pollOnce();

    expect(fetched).toBe(false);
    expect(result.found).toBe(0);
    expect(result.added).toBe(0);
  });

  it("no new workers spawned when stop() is called mid-poll", async () => {
    const spawned: string[] = [];
    let resolveFetch!: (issues: LinearIssue[]) => void;
    const fetchPromise = new Promise<LinearIssue[]>((r) => {
      resolveFetch = r;
    });

    const coord = new AgentCoordinator(
      {
        fetchTodo: () => fetchPromise,
        fetchInProgress: async () => [],
        fetchReview: async () => [],
        fetchMentions: async () => [],
        fetchDoneCandidates: async () => [],
        fetchComments: async () => [],
        prepare: async (issue) => ({ changeName: issue.id }),
        spawnWorker: (_name, issue) => {
          spawned.push(issue.id);
          return makeHandle();
        },
        applyIndicator: async () => {},
        removeIndicator: async () => {},
        postComment: async () => {},
        checkPrStatus: async () => null,
        onLog: () => {},
        onWorkersChanged: () => {},
      },
      { concurrency: 1 },
    );

    const pollPromise = coord.pollOnce();
    coord.stop();
    resolveFetch([makeIssue("r")]);
    await pollPromise;
    await flush();

    expect(spawned).toHaveLength(0);
  });
});

// ─── S6.8 — stopped coordinator skips all poll work ─────────────────────────

describe("S6.8 — stopped coordinator never invokes Linear fetchers", () => {
  it("five consecutive pollOnce calls on stopped coordinator never fetch", async () => {
    let fetchCalls = 0;
    const coord = new AgentCoordinator(
      {
        fetchTodo: async () => {
          fetchCalls++;
          return [];
        },
        fetchInProgress: async () => [],
        fetchReview: async () => [],
        fetchMentions: async () => [],
        fetchDoneCandidates: async () => [],
        fetchComments: async () => [],
        prepare: async (issue) => ({ changeName: issue.id }),
        spawnWorker: () => makeHandle(),
        applyIndicator: async () => {},
        removeIndicator: async () => {},
        postComment: async () => {},
        checkPrStatus: async () => null,
        onLog: () => {},
        onWorkersChanged: () => {},
      },
      { concurrency: 1 },
    );

    coord.stop();
    for (let i = 0; i < 5; i++) await coord.pollOnce();
    expect(fetchCalls).toBe(0);
  });
});

// ─── S6.9 — third ticket picked up exactly once ──────────────────────────────

describe("S6.9 — third queued ticket spawned exactly once after two concurrent exits", () => {
  it("concurrency=2: first two exit simultaneously, third spawned exactly once", async () => {
    const issues = [makeIssue("s1"), makeIssue("s2"), makeIssue("s3")];
    const { coord, handles, spawned } = makeCoord({ concurrency: 2 }, issues);

    await coord.pollOnce();
    await flush();
    // concurrency=2 → first two spawned, third stays queued
    expect(spawned).toHaveLength(2);

    // Both workers exit simultaneously
    handles[0]!.resolve(0);
    handles[1]!.resolve(0);
    await flush();

    // Third ticket must be spawned exactly once
    expect(spawned).toHaveLength(3);
    expect(spawned[2]).toBe("s3");
  });
});
