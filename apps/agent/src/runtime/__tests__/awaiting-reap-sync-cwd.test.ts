import { describe, expect, test, mock } from "bun:test";
import { AgentCoordinator, type ActiveWorker, type CoordinatorDeps } from "../coordinator";
import type { TrackedIssue } from "@ralphy/tracker";
import type { EmitInput } from "@ralphy/events";
import { recordingBus } from "../../__test-utils__/recording-bus";

function makeIssue(id: string, identifier: string): TrackedIssue {
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

/** The awaiting-reap syncTasks flush must receive the worker's cwd so the
 *  comment-sync hook can resolve the WORKTREE change dir — by the time the
 *  flush runs, the wire layer has already cleared cwdByChange (LIT-387:
 *  design.md only existed in the worktree, flush read projectRoot, no design
 *  attachment was ever uploaded). */
describe("AgentCoordinator — awaiting-reap syncTasks flush carries worker cwd", () => {
  async function runReapScenario(): Promise<(ActiveWorker | undefined)[]> {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const issue = makeIssue("a", "RLF-300");
    const syncedWorkers: ActiveWorker[] = [];

    const deps: CoordinatorDeps = {
      fetchTodo: mock(async () => [issue]),
      fetchInProgress: mock(async () => []),
      fetchMentions: mock(async () => []),
      fetchDoneCandidates: mock(async () => []),
      fetchReview: mock(async () => []),
      prepare: mock(async (i: TrackedIssue) => ({
        changeName: `change-${i.identifier.toLowerCase()}`,
        cwd: "/wt/rlf-300",
      })),
      spawnWorker: mock(() => {
        let resolve!: (code: number) => void;
        const exited = new Promise<number>((r) => {
          resolve = r;
        });
        return { exited, kill: () => resolve(143) };
      }),
      syncTasks: mock(async (w: ActiveWorker) => {
        syncedWorkers.push({ ...w });
      }),
      getIterationCount: mock(async () => 0),
      applyIndicator: mock(async () => {}),
      removeIndicator: mock(async () => {}),
      postComment: mock(async () => {}),
      fetchComments: mock(async () => []),
      checkPrStatus: mock(async () => null),
      onLog: () => {},
      onWorkersChanged: () => {},
      bus,
    };

    const coord = new AgentCoordinator(deps, { concurrency: 1 });
    await coord.init();
    await coord.pollOnce();
    await coord.whenSettled();
    expect(coord.activeCount).toBe(1);

    syncedWorkers.length = 0; // ignore the launch-time sync
    coord.reapForAwaiting("change-rlf-300");
    await coord.whenSettled();

    expect(syncedWorkers.length).toBe(1); // the awaiting-reap flush
    return syncedWorkers;
  }

  test("fix_case: the reap flush worker carries the prepare-time cwd", async () => {
    const [flushed] = await runReapScenario();
    expect(flushed?.cwd).toBe("/wt/rlf-300");
  });
});
