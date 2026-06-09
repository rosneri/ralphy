import { describe, expect, test, mock } from "bun:test";
import { AgentCoordinator, type CoordinatorDeps } from "../coordinator";
import type { TrackedIssue } from "@ralphy/tracker";
import type { Bus, EmitInput } from "@ralphy/events";
import type { FeatureCtx } from "../../features/types";
import { recordingBus } from "../../__test-utils__/recording-bus";

function makeIssue(id: string, identifier: string, labels: string[] = []): TrackedIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels,
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

function baseDeps(opts: {
  todo: TrackedIssue[];
  inProgress: TrackedIssue[];
  bus: Bus;
  onSpawn: () => void;
}): CoordinatorDeps {
  return {
    fetchTodo: mock(async () => opts.todo),
    fetchInProgress: mock(async () => opts.inProgress),
    fetchMentions: mock(async () => []),
    fetchDoneCandidates: mock(async () => []),
    fetchReview: mock(async () => []),
    prepare: mock(async (i: TrackedIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    spawnWorker: mock(() => {
      opts.onSpawn();
      let resolve!: (code: number) => void;
      const exited = new Promise<number>((r) => {
        resolve = r;
      });
      return { exited, kill: () => resolve(143) };
    }),
    applyIndicator: mock(async () => {}),
    removeIndicator: mock(async () => {}),
    postComment: mock(async () => {}),
    fetchComments: mock(async () => []),
    checkPrStatus: mock(async () => null),
    onLog: () => {},
    onWorkersChanged: () => {},
    bus: opts.bus,
  };
}

describe("AgentCoordinator/pollOnce — confirmation-claimed ticket also in fetchTodo", () => {
  test("label-based getTodo + confirmation claim does not enqueue fresh / spawn worker", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const issue = makeIssue("a", "RLF-101", ["manual-test-rlf87-confirm"]);

    let spawnCount = 0;
    const deps = baseDeps({
      todo: [issue],
      inProgress: [issue],
      bus,
      onSpawn: () => {
        spawnCount += 1;
      },
    });

    deps.buildFeatureCtx = (i): FeatureCtx => ({
      issue: i,
      worktree: "/tmp",
      state: { writeField: async () => {} },
      bus,
      caps: {
        gh: null,
        linear: null,
        git: null,
        fsChange: null,
        worker: null,
        confirmation: {
          detect: async () => true,
          run: async () => {},
        },
      },
      poll: {} as FeatureCtx["poll"],
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    const coord = new AgentCoordinator(deps, { concurrency: 1 });
    await coord.init();
    const result = await coord.pollOnce();

    expect(result.added).toBe(0);
    expect(result.buckets.awaiting).toBe(1);
    expect(coord.queuedCount).toBe(0);
    expect(coord.activeCount).toBe(0);
    expect(spawnCount).toBe(0);

    const types = events.map((e) => String(e.type));
    expect(types).toContain("feature.confirmation.detected");
    expect(types).toContain("feature.confirmation.completed");
  });
});
