import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { stuckFeature, emitStuckSkipped } from "../index";
import { recordingBus, makeBareCtx } from "../../../__test-utils__/recording-bus";

describe("stuck feature", () => {
  test("descriptor: id, ownedSlot null", () => {
    expect(stuckFeature.id).toBe("stuck");
    expect(stuckFeature.ownedSlot).toBeNull();
  });

  test("detect returns null — slice never claims the per-poll walk", async () => {
    const ctx = makeBareCtx();
    expect(await stuckFeature.detect(ctx)).toBeNull();
  });

  test("run is a no-op (resolves without touching ctx)", async () => {
    const ctx = makeBareCtx();
    await expect(stuckFeature.run(ctx, { reason: "n/a" })).resolves.toBeUndefined();
  });

  test("emitStuckSkipped emits feature.stuck.skipped with the reason", () => {
    const events: EmitInput[] = [];
    emitStuckSkipped(recordingBus(events), "preempted-by:confirmation");
    expect(events).toEqual([
      { type: "feature.stuck.skipped", reason: "preempted-by:confirmation" } as EmitInput,
    ]);
  });
});
