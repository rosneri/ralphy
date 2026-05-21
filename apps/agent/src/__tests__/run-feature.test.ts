import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { detectFeature, runFeature } from "../features/run-feature";
import { makeBareCtx, recordingBus } from "../__test-utils__/recording-bus";
import type { Feature } from "../features/types";

function makeFeature(overrides: Partial<Feature>): Feature {
  return {
    id: "mention",
    ownedSlot: null,
    detect: async () => null,
    run: async () => {},
    ...overrides,
  };
}

describe("run-feature error paths", () => {
  test("detectFeature swallows throws and emits feature.<id>.failed { phase: 'detect' }", async () => {
    const events: EmitInput[] = [];
    const ctx = { ...makeBareCtx(), bus: recordingBus(events) };
    const feature = makeFeature({
      detect: async () => {
        throw new Error("boom-detect");
      },
    });

    const match = await detectFeature(feature, ctx);

    expect(match).toBeNull();
    expect(events).toEqual([
      { type: "feature.mention.failed", error: "boom-detect", phase: "detect" },
    ]);
  });

  test("runFeature swallows throws and emits feature.<id>.failed { phase: 'run' }", async () => {
    const events: EmitInput[] = [];
    const ctx = { ...makeBareCtx(), bus: recordingBus(events) };
    const feature = makeFeature({
      run: async () => {
        throw new Error("boom-run");
      },
    });

    await runFeature(feature, ctx, { reason: "test" });

    expect(events.map((e) => e.type)).toEqual([
      "feature.mention.detected",
      "feature.mention.started",
      "feature.mention.failed",
    ]);
    expect(events[2]).toMatchObject({ error: "boom-run", phase: "run" });
  });

  test("formatError falls back to 'unknown error' when String(err) throws", async () => {
    const events: EmitInput[] = [];
    const ctx = { ...makeBareCtx(), bus: recordingBus(events) };
    // Non-Error throw whose String() coercion itself throws — exercises the
    // inner try/catch in formatError (run-feature.ts:37-39).
    const hostile = {
      toString() {
        throw new Error("nope");
      },
    };
    const feature = makeFeature({
      detect: async () => {
        throw hostile;
      },
    });

    await detectFeature(feature, ctx);

    expect(events[0]).toMatchObject({
      type: "feature.mention.failed",
      error: "unknown error",
      phase: "detect",
    });
  });
});
