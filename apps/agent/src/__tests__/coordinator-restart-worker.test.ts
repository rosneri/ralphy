import { describe, expect, test, mock } from "bun:test";
import { AgentCoordinator, type CoordinatorDeps, type QueueTrigger } from "../agent/coordinator";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { SetIndicator } from "@ralphy/types";
import { trackerFromFlat } from "../../test/harness/provider-contract";

function issue(id: string, identifier: string): TrackedIssue {
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
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

interface FakeWorker {
  resolve: (code: number) => void;
  killCount: number;
  exited: Promise<number>;
}

function makeCtx() {
  const workers: FakeWorker[] = [];
  const spawnArgs: Array<{ changeName: string; trigger: QueueTrigger }> = [];
  const applies: { id: string; ind: SetIndicator }[] = [];
  const removes: { id: string; ind: SetIndicator }[] = [];
  const comments: { id: string; body: string }[] = [];
  const triggerByCall: QueueTrigger[] = [];

  let coordRef: { coord?: AgentCoordinator } = {};

  const flat: Partial<IssueTrackerProvider> = {
    fetchTodo: mock(async () => []),
    fetchInProgress: mock(async () => []),
    fetchMentions: mock(async () => []),
    fetchDoneCandidates: mock(async () => []),
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
  };

  const deps: CoordinatorDeps = {
    tracker: trackerFromFlat(flat),
    prepare: mock(async (i: TrackedIssue) => {
      return { changeName: `change-${i.identifier.toLowerCase()}` };
    }),
    spawnWorker: mock((changeName: string) => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      const w: FakeWorker = { resolve, killCount: 0, exited };
      workers.push(w);
      // The coordinator pushes the ActiveWorker (with its trigger) right
      // after spawnWorker returns, so we defer reading the trigger to a
      // microtask. Tests then assert on `spawnArgs` after a tick.
      Promise.resolve().then(() => {
        const active = coordRef.coord?.activeWorkers.find((aw) => aw.changeName === changeName);
        const trigger = active?.trigger ?? "fresh";
        triggerByCall.push(trigger);
        spawnArgs.push({ changeName, trigger });
      });
      return {
        exited,
        kill: () => {
          w.killCount += 1;
          resolve(143);
        },
      };
    }),
    checkPrStatus: async () => null,
    onLog: () => {},
    onWorkersChanged: () => {},
  };

  return { deps, flat, workers, spawnArgs, applies, removes, comments, triggerByCall, coordRef };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

const SET_IN_PROGRESS: SetIndicator = { type: "label", value: "in-progress" };
const SET_DONE: SetIndicator = { type: "label", value: "done" };
const SET_ERROR: SetIndicator = { type: "label", value: "error" };

describe("AgentCoordinator.restartWorker", () => {
  test("kills active worker once, re-spawns as resume, and does not finalize the issue", async () => {
    const ctx = makeCtx();
    const coord = (ctx.coordRef.coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setInProgress: SET_IN_PROGRESS,
      setDone: SET_DONE,
      setError: SET_ERROR,
    }));
    await coord.init();

    // Seed an active worker by polling once.
    (ctx.flat.fetchTodo as ReturnType<typeof mock>).mockImplementationOnce(async () => [
      issue("a", "ENG-1"),
    ]);
    await coord.pollOnce();
    await tick();
    expect(coord.activeCount).toBe(1);
    expect(ctx.workers).toHaveLength(1);
    const compsBefore = ctx.comments.length;
    const appliesBefore = ctx.applies.length;
    const removesBefore = ctx.removes.length;
    const ticketsBefore = coord.ticketsStartedCount;

    const ok = await coord.restartWorker("change-eng-1");
    expect(ok).toBe(true);
    expect(ctx.workers[0]!.killCount).toBe(1);

    // Let the exit handler run.
    await tick();
    await tick();

    // A new worker should have been spawned as resume.
    expect(ctx.workers).toHaveLength(2);
    expect(ctx.spawnArgs[1]).toEqual({ changeName: "change-eng-1", trigger: "resume" });

    // No finalize side-effects (no setDone/setError, no completion comment).
    expect(ctx.applies.slice(appliesBefore).map((a) => a.ind)).not.toContain(SET_DONE);
    expect(ctx.applies.slice(appliesBefore).map((a) => a.ind)).not.toContain(SET_ERROR);
    expect(ctx.removes.length).toBe(removesBefore);
    const newComments = ctx.comments.slice(compsBefore).map((c) => c.body);
    expect(newComments.every((b) => !b.startsWith("✅") && !b.startsWith("✗"))).toBe(true);

    // ticketsStarted unchanged after full cycle.
    expect(coord.ticketsStartedCount).toBe(ticketsBefore);
  });

  test("restartWorker on an unknown change returns false and does not kill anything", async () => {
    const ctx = makeCtx();
    const coord = (ctx.coordRef.coord = new AgentCoordinator(ctx.deps, { concurrency: 1 }));
    await coord.init();
    (ctx.flat.fetchTodo as ReturnType<typeof mock>).mockImplementationOnce(async () => [
      issue("a", "ENG-1"),
    ]);
    await coord.pollOnce();
    await tick();

    const ok = await coord.restartWorker("nope");
    expect(ok).toBe(false);
    expect(ctx.workers[0]!.killCount).toBe(0);
  });

  test("restartWorker after stop() returns false", async () => {
    const ctx = makeCtx();
    const coord = (ctx.coordRef.coord = new AgentCoordinator(ctx.deps, { concurrency: 1 }));
    await coord.init();
    (ctx.flat.fetchTodo as ReturnType<typeof mock>).mockImplementationOnce(async () => [
      issue("a", "ENG-1"),
    ]);
    await coord.pollOnce();
    await tick();

    coord.stop();
    const ok = await coord.restartWorker("change-eng-1");
    expect(ok).toBe(false);
  });
});
