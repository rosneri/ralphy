import { describe, expect, test, mock } from "bun:test";
import { AgentCoordinator, type CoordinatorDeps } from "../agent/coordinator";
import { NO_CHANGES_EXIT } from "../agent/post-task";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { SetIndicator } from "@ralphy/types";
import { trackerFromFlat } from "../../test/harness/provider-contract";

// When a worker exits NO_CHANGES_EXIT (branch only ever touched meta files —
// the requested work is already on base), the coordinator must finalize the
// ticket as DONE with an honest "no changes" comment, NOT quarantine it with
// setError. This is the LIT-300 fix: a no-op must not re-summon or quarantine.

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
  exited: Promise<number>;
}

function makeCtx() {
  const workers: FakeWorker[] = [];
  const applies: { id: string; ind: SetIndicator }[] = [];
  const removes: { id: string; ind: SetIndicator }[] = [];
  const comments: { id: string; body: string }[] = [];

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
    prepare: mock(async (i: TrackedIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    spawnWorker: mock(() => {
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      workers.push({ resolve, exited });
      return { exited, kill: () => resolve(143) };
    }),
    checkPrStatus: async () => null,
    onLog: () => {},
    onWorkersChanged: () => {},
  };

  return { deps, flat, workers, applies, removes, comments };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

const SET_IN_PROGRESS: SetIndicator = { type: "label", value: "in-progress" };
const SET_DONE: SetIndicator = { type: "label", value: "done" };
const SET_ERROR: SetIndicator = { type: "label", value: "error" };

describe("AgentCoordinator — NO_CHANGES_EXIT finalization", () => {
  test("marks done with a no-op comment and clears in-progress, never setError", async () => {
    const ctx = makeCtx();
    const coord = new AgentCoordinator(ctx.deps, {
      concurrency: 1,
      setInProgress: SET_IN_PROGRESS,
      setDone: SET_DONE,
      setError: SET_ERROR,
    });
    await coord.init();

    (ctx.flat.fetchTodo as ReturnType<typeof mock>).mockImplementationOnce(async () => [
      issue("a", "LIT-300"),
    ]);
    await coord.pollOnce();
    await tick();
    expect(ctx.workers).toHaveLength(1);

    // Worker finishes its tasks but produced only meta files.
    ctx.workers[0]!.resolve(NO_CHANGES_EXIT);
    await tick();
    await tick();

    const appliedInds = ctx.applies.map((a) => a.ind);
    expect(appliedInds).toContainEqual(SET_DONE);
    expect(appliedInds).not.toContainEqual(SET_ERROR);
    expect(ctx.removes.map((r) => r.ind)).toContainEqual(SET_IN_PROGRESS);

    const body = ctx.comments.at(-1)?.body ?? "";
    expect(body).toContain("no code changes");
    expect(body).toContain("No PR was opened");
    expect(body).not.toContain("quarantined");
  });
});
