import { describe, expect, test } from "bun:test";
import type { Bus, EmitInput } from "@ralphy/events";
import { stuckFeature, emitStuckSkipped } from "../index";
import type { FeatureCtx } from "../../types";

function recordingBus(events: EmitInput[]): Bus {
  return {
    emit: (e: EmitInput) => {
      events.push(e);
    },
    subscribe: () => () => {},
  } as unknown as Bus;
}

describe("stuck feature", () => {
  test("descriptor: id, ownedSlot null", () => {
    expect(stuckFeature.id).toBe("stuck");
    expect(stuckFeature.ownedSlot).toBeNull();
  });

  test("detect returns null — slice never claims the per-poll walk", async () => {
    const ctx = {} as unknown as FeatureCtx;
    expect(await stuckFeature.detect(ctx)).toBeNull();
  });

  test("run is a no-op (resolves without touching ctx)", async () => {
    const ctx = {} as unknown as FeatureCtx;
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
