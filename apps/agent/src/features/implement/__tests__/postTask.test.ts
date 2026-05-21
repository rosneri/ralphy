import { describe, expect, test } from "bun:test";
import type { Bus, EmitInput } from "@ralphy/events";
import type { LinearIssue } from "../../../agent/linear";
import type { FeatureCtx, TaskResult } from "../../types";
import { implementPostTask } from "../postTask";
import { recordingBus } from "../../../__test-utils__/recording-bus";

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

interface CtxOverrides {
  implement?: { getPrUrl: () => Promise<string | null> };
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
      ...(overrides.implement ? { implement: overrides.implement } : {}),
    },
    poll: {} as FeatureCtx["poll"],
    now: () => new Date("2026-05-21T00:00:00.000Z"),
  };
}

const okResult: TaskResult = { exitCode: 0, branch: "ralph/my-change" };

describe("implement/postTask — PR URL verification only", () => {
  test("no-op (no events) when `caps.implement` is not wired", async () => {
    const events: EmitInput[] = [];
    const ctx = makeCtx(recordingBus(events));
    await implementPostTask(ctx, okResult);
    expect(events).toEqual([]);
  });

  test("skips check when worker exited non-zero", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      implement: {
        getPrUrl: async () => {
          calls += 1;
          return "https://github.com/o/r/pull/1";
        },
      },
    });
    await implementPostTask(ctx, { exitCode: 1, branch: "ralph/my-change" });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("skips check when the worker produced no branch", async () => {
    const events: EmitInput[] = [];
    let calls = 0;
    const ctx = makeCtx(recordingBus(events), {
      implement: {
        getPrUrl: async () => {
          calls += 1;
          return "https://github.com/o/r/pull/1";
        },
      },
    });
    await implementPostTask(ctx, { exitCode: 0, branch: null });
    expect(calls).toBe(0);
    expect(events).toEqual([]);
  });

  test("PR found → emits completed + transitioned and writes state.pr + state.pr.flow", async () => {
    const events: EmitInput[] = [];
    const writes: { path: string; value: unknown }[] = [];
    const url = "https://github.com/o/r/pull/42";
    const ctx = makeCtx(recordingBus(events), {
      implement: { getPrUrl: async () => url },
      stateWrites: writes,
    });
    await implementPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.implement.completed",
        outcome: "opened",
        prUrl: url,
      },
      {
        type: "feature.implement.transitioned",
        to: "awaiting-ci",
      },
    ]);
    expect(writes).toEqual([
      { path: "pr.url", value: url },
      { path: "pr.openedAt", value: "2026-05-21T00:00:00.000Z" },
      { path: "pr.flow", value: "awaiting-ci" },
    ]);
  });

  test("PR not found → emits feature.implement.failed { error: 'no-pr' }", async () => {
    const events: EmitInput[] = [];
    const writes: { path: string; value: unknown }[] = [];
    const ctx = makeCtx(recordingBus(events), {
      implement: { getPrUrl: async () => null },
      stateWrites: writes,
    });
    await implementPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.implement.failed",
        error: "no-pr",
      },
    ]);
    expect(writes).toEqual([]);
  });

  test("state writes are swallowed (event still fires) when writeField throws", async () => {
    const events: EmitInput[] = [];
    const ctx: FeatureCtx = {
      ...makeCtx(recordingBus(events), {
        implement: { getPrUrl: async () => "https://github.com/o/r/pull/3" },
      }),
      state: {
        writeField: async () => {
          throw new Error("ownership-error");
        },
      },
    };
    await implementPostTask(ctx, okResult);
    expect(events).toEqual([
      {
        type: "feature.implement.completed",
        outcome: "opened",
        prUrl: "https://github.com/o/r/pull/3",
      },
      {
        type: "feature.implement.transitioned",
        to: "awaiting-ci",
      },
    ]);
  });
});
