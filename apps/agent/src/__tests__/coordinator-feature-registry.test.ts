import { describe, expect, test, mock } from "bun:test";
import { AgentCoordinator, type CoordinatorDeps } from "../agent/coordinator";
import type { LinearIssue } from "../agent/linear";
import type { Bus, EmitInput } from "@ralphy/events";
import type { FeatureCtx } from "../features/types";
import { recordingBus } from "../__test-utils__/recording-bus";

function issue(id: string, identifier: string): LinearIssue {
  return {
    id,
    identifier,
    title: `Issue ${identifier}`,
    description: null,
    url: `https://example/${identifier}`,
    state: { name: "In Progress", type: "started" },
    assignee: null,
    project: null,
    labels: [],
    priority: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    blockedByIds: [],
  };
}

function baseDeps(inProgress: LinearIssue[], bus: Bus): CoordinatorDeps {
  return {
    fetchTodo: mock(async () => []),
    fetchInProgress: mock(async () => inProgress),
    fetchMentions: mock(async () => []),
    fetchDoneCandidates: mock(async () => []),
    prepare: mock(async (i: LinearIssue) => ({
      changeName: `change-${i.identifier.toLowerCase()}`,
    })),
    spawnWorker: mock(() => {
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
    bus,
  };
}

describe("AgentCoordinator — feature registry walk", () => {
  test("skips the walk entirely when buildFeatureCtx is not wired", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const ip = [issue("a", "ENG-1")];
    const deps = baseDeps(ip, bus);
    const coord = new AgentCoordinator(deps, { concurrency: 1 });
    await coord.init();
    const result = await coord.pollOnce();

    // Legacy resume path still owns the issue.
    expect(result.added).toBe(1);
    expect(events.some((e) => String(e.type).startsWith("feature."))).toBe(false);
  });

  test("walks the registry for each in-progress issue, emits skipped for losers", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const ip = [issue("a", "ENG-1")];
    const deps = baseDeps(ip, bus);
    // Stub features all return null from `detect`, so calling the walk
    // should emit no feature events — but `buildFeatureCtx` must have been
    // consulted exactly once per in-progress issue.
    let ctxCalls = 0;
    deps.buildFeatureCtx = (i) => {
      ctxCalls += 1;
      return {
        issue: i,
        worktree: "/tmp",
        state: { writeField: async () => {} },
        bus,
        caps: { gh: null, linear: null, git: null, fsChange: null, worker: null },
        // PollContext is not exercised here — we only need the type slot.
        poll: {} as FeatureCtx["poll"],
        now: () => new Date("2026-05-21T00:00:00.000Z"),
      };
    };
    const coord = new AgentCoordinator(deps, { concurrency: 1 });
    await coord.init();
    const result = await coord.pollOnce();

    expect(ctxCalls).toBe(1);
    // No stub feature matched, so nothing was claimed → legacy resume queued.
    expect(result.added).toBe(1);
    // No matched feature, so no detected/started/completed/skipped events.
    expect(events.filter((e) => String(e.type).startsWith("feature."))).toEqual([]);
  });

  test("a feature claim skips the legacy resume queue", async () => {
    const events: EmitInput[] = [];
    const bus = recordingBus(events);
    const ip = [issue("a", "ENG-1")];
    const deps = baseDeps(ip, bus);
    deps.buildFeatureCtx = (i) =>
      ({
        issue: i,
        worktree: "/tmp",
        state: { writeField: async () => {} },
        bus,
        caps: { gh: null, linear: null, git: null, fsChange: null, worker: null },
        poll: {} as FeatureCtx["poll"],
        now: () => new Date("2026-05-21T00:00:00.000Z"),
      }) as FeatureCtx;

    // Monkey-patch the registry's first feature to return a match. We use
    // bus emit interception to verify the dispatch path fired without
    // depending on a real adapter (none exist yet at this point in the
    // migration).
    const { registry } = await import("../features/registry");
    const original = registry[0]!.detect;
    (registry[0] as { detect: typeof original }).detect = async () => ({
      reason: "test-claim",
    });
    try {
      const coord = new AgentCoordinator(deps, { concurrency: 1 });
      await coord.init();
      const result = await coord.pollOnce();

      // Feature claimed it → legacy resume queue must not enqueue.
      expect(result.added).toBe(0);

      const types = events.map((e) => String(e.type));
      expect(types).toContain(`feature.${registry[0]!.id}.detected`);
      expect(types).toContain(`feature.${registry[0]!.id}.started`);
      expect(types).toContain(`feature.${registry[0]!.id}.completed`);
      // Lower-priority detectors must have been emitted as skipped.
      const skipped = types.filter((t) => t.endsWith(".skipped"));
      expect(skipped.length).toBe(registry.length - 1);
    } finally {
      (registry[0] as { detect: typeof original }).detect = original;
    }
  });
});
