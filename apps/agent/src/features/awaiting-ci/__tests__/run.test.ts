import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { recordingBus, makeBareCtx } from "../../../__test-utils__/recording-bus";
import { runAwaitingCi } from "../run";
import type { FeatureCtx } from "../../types";

function ctxWith(
  events: EmitInput[],
  status: "pass" | "fail" | "pending" | "unknown",
  calls: { n: number },
): FeatureCtx {
  const base = makeBareCtx();
  return {
    ...base,
    bus: recordingBus(events),
    caps: {
      ...base.caps,
      ciFix: {
        getCiStatus: async () => {
          calls.n += 1;
          return status;
        },
      },
    },
  };
}

describe("awaiting-ci/run — one gh call, one event", () => {
  test("pass → feature.awaiting-ci.completed { outcome: 'pass' }", async () => {
    const events: EmitInput[] = [];
    const calls = { n: 0 };
    await runAwaitingCi(ctxWith(events, "pass", calls));
    expect(calls.n).toBe(1);
    expect(events).toEqual([{ type: "feature.awaiting-ci.completed", outcome: "pass" }]);
  });

  test("fail → feature.awaiting-ci.failed { error: 'ci-failing' }", async () => {
    const events: EmitInput[] = [];
    const calls = { n: 0 };
    await runAwaitingCi(ctxWith(events, "fail", calls));
    expect(calls.n).toBe(1);
    expect(events).toEqual([{ type: "feature.awaiting-ci.failed", error: "ci-failing" }]);
  });

  test("pending → feature.awaiting-ci.completed { outcome: 'pending' }", async () => {
    const events: EmitInput[] = [];
    const calls = { n: 0 };
    await runAwaitingCi(ctxWith(events, "pending", calls));
    expect(calls.n).toBe(1);
    expect(events).toEqual([{ type: "feature.awaiting-ci.completed", outcome: "pending" }]);
  });

  test("unknown → feature.awaiting-ci.completed { outcome: 'unknown' }", async () => {
    const events: EmitInput[] = [];
    const calls = { n: 0 };
    await runAwaitingCi(ctxWith(events, "unknown", calls));
    expect(calls.n).toBe(1);
    expect(events).toEqual([{ type: "feature.awaiting-ci.completed", outcome: "unknown" }]);
  });

  test("missing ciFix capability → emits failed without calling gh", async () => {
    const events: EmitInput[] = [];
    const base = makeBareCtx();
    const ctx: FeatureCtx = { ...base, bus: recordingBus(events) };
    await runAwaitingCi(ctx);
    expect(events).toEqual([{ type: "feature.awaiting-ci.failed", error: "missing-ci-fix-cap" }]);
  });
});
