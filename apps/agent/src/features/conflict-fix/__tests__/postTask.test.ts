import { describe, expect, test } from "bun:test";
import type { Bus, EmitInput } from "@ralphy/events";
import type { LinearIssue } from "../../../agent/linear";
import type { FeatureCtx, TaskResult } from "../../types";
import { conflictFixPostTask } from "../postTask";

const FAKE_ISSUE: LinearIssue = {
  id: "issue-1",
  identifier: "COD-1",
  title: "Test issue",
  url: "https://linear.app/team/issue/COD-1",
  description: "",
  priority: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  blockedByIds: [],
  state: { name: "In Progress", type: "started" },
  assignee: null,
  project: null,
  labels: [],
};

function recordingBus(events: EmitInput[]): Bus {
  return {
    emit: (e: EmitInput) => {
      events.push(e);
    },
    subscribe: () => () => {},
  } as unknown as Bus;
}

function makeCtx(
  bus: Bus,
  conflictFix?: { getMergeability: () => Promise<"mergeable" | "conflicting" | "unknown"> },
): FeatureCtx {
  return {
    issue: FAKE_ISSUE,
    worktree: "/tmp",
    state: { writeField: async () => {} },
    bus,
    caps: {
      gh: null,
      linear: null,
      git: null,
      fsChange: null,
      worker: null,
      ...(conflictFix ? { conflictFix } : {}),
    },
    poll: {} as FeatureCtx["poll"],
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  };
}

const okResult: TaskResult = { exitCode: 0, branch: "ralph/my-change" };

describe("conflict-fix/postTask — mergeability verification only", () => {
  test("no-op (no events) when `caps.conflictFix` is not wired", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events));
    await conflictFixPostTask(ctx, okResult);
    expect(events).toEqual([]);
  });

  test("skips check when worker exited non-zero", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      getMergeability: async () => {
        calls += 1;
        return "mergeable";
      },
    });
    await conflictFixPostTask(ctx, { exitCode: 1, branch: "ralph/my-change" });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("skips check when the worker produced no branch", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      getMergeability: async () => {
        calls += 1;
        return "mergeable";
      },
    });
    await conflictFixPostTask(ctx, { exitCode: 0, branch: null });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("mergeable → emits feature.conflict-fix.completed { outcome: 'mergeable' }", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      getMergeability: async () => "mergeable",
    });
    await conflictFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.conflict-fix.completed",
        outcome: "mergeable",
      } as unknown as EmitInput,
    ]);
  });

  test("conflicting → emits feature.conflict-fix.failed { error: 'pr-conflicting' } and never re-fixes", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      getMergeability: async () => "conflicting",
    });
    await conflictFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.conflict-fix.failed",
        error: "pr-conflicting",
      } as unknown as EmitInput,
    ]);
  });

  test("unknown → emits completed with outcome 'unknown' (no false positive)", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      getMergeability: async () => "unknown",
    });
    await conflictFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.conflict-fix.completed",
        outcome: "unknown",
      } as unknown as EmitInput,
    ]);
  });
});
