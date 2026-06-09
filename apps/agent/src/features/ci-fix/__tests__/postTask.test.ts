import { describe, expect, test } from "bun:test";
import type { Bus, EmitInput } from "@ralphy/events";
import type { TrackedIssue } from "@ralphy/tracker";
import type { FeatureCtx, TaskResult } from "../../types";
import { ciFixPostTask } from "../postTask";
import { recordingBus } from "../../../__test-utils__/recording-bus";

const FAKE_ISSUE: TrackedIssue = {
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

interface CtxOverrides {
  ciFix?: { getCiStatus: () => Promise<"pass" | "fail" | "pending" | "unknown"> };
  stateWrites?: { path: string; value: unknown }[];
}

function makeCtx(bus: Bus, overrides: CtxOverrides = {}): FeatureCtx {
  return {
    issue: FAKE_ISSUE,
    worktree: "/tmp",
    state: {
      writeField: async (path, value) => {
        overrides.stateWrites?.push({ path, value });
      },
    },
    bus,
    caps: {
      gh: null,
      linear: null,
      git: null,
      fsChange: null,
      worker: null,
      ...(overrides.ciFix ? { ciFix: overrides.ciFix } : {}),
    },
    poll: {} as FeatureCtx["poll"],
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  };
}

const okResult: TaskResult = { exitCode: 0, branch: "ralph/my-change" };

describe("ci-fix/postTask — CI verification only", () => {
  test("no-op (no events) when `caps.ciFix` is not wired", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events));
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([]);
  });

  test("skips check when worker exited non-zero", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      ciFix: {
        getCiStatus: async () => {
          calls += 1;
          return "pass";
        },
      },
    });
    await ciFixPostTask(ctx, { exitCode: 1, branch: "ralph/my-change" });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("skips check when the worker produced no branch", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      ciFix: {
        getCiStatus: async () => {
          calls += 1;
          return "pass";
        },
      },
    });
    await ciFixPostTask(ctx, { exitCode: 0, branch: null });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("pass → emits feature.ci-fix.completed { outcome: 'pass' } and writes state.ci", async () => {
    const events: EmitInput[] = [];
    const writes: { path: string; value: unknown }[] = [];
    const ctx = makeCtx(recordingBus(events), {
      ciFix: { getCiStatus: async () => "pass" },
      stateWrites: writes,
    });
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.ci-fix.completed",
        outcome: "pass",
      },
    ]);
    expect(writes).toEqual([
      { path: "ci.lastCheckedAt", value: "2026-05-21T00:00:00.000Z" },
      { path: "ci.lastBucket", value: "pass" },
    ]);
  });

  test("fail → emits feature.ci-fix.failed { error: 'ci-failing' } and never re-fixes", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      ciFix: { getCiStatus: async () => "fail" },
    });
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.ci-fix.failed",
        error: "ci-failing",
      },
    ]);
  });

  test("pending → emits completed with outcome 'pending' (still settling)", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      ciFix: { getCiStatus: async () => "pending" },
    });
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.ci-fix.completed",
        outcome: "pending",
      },
    ]);
  });

  test("unknown → emits completed with outcome 'unknown' (no false positive)", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events), {
      ciFix: { getCiStatus: async () => "unknown" },
    });
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.ci-fix.completed",
        outcome: "unknown",
      },
    ]);
  });

  test("state writes are swallowed (events still fire) when writeField throws", async () => {
    const events: EmitInput[] = [];
    const ctx: FeatureCtx = {
      ...makeCtx(recordingBus(events), {
        ciFix: { getCiStatus: async () => "pass" },
      }),
      state: {
        writeField: async () => {
          throw new Error("ownership-error");
        },
      },
    };
    await ciFixPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.ci-fix.completed",
        outcome: "pass",
      },
    ]);
  });
});
