import { describe, expect, test } from "bun:test";
import type { Bus, EmitInput } from "@ralphy/events";
import { newTicketFeature, emitNewTicketSkipped } from "../index";
import type { FeatureCtx } from "../../types";

function recordingBus(events: EmitInput[]): Bus {
  return {
    emit: (e: EmitInput) => {
      events.push(e);
    },
    subscribe: () => () => {},
  } as unknown as Bus;
}

describe("new-ticket feature", () => {
  test("descriptor: id, ownedSlot null", () => {
    expect(newTicketFeature.id).toBe("new-ticket");
    expect(newTicketFeature.ownedSlot).toBeNull();
  });

  test("detect returns null — slice never claims the per-poll walk", async () => {
    const ctx = {} as unknown as FeatureCtx;
    expect(await newTicketFeature.detect(ctx)).toBeNull();
  });

  test("run is a no-op (resolves without touching ctx)", async () => {
    const ctx = {} as unknown as FeatureCtx;
    await expect(newTicketFeature.run(ctx, { reason: "n/a" })).resolves.toBeUndefined();
  });

  test("emitNewTicketSkipped emits feature.new-ticket.skipped with the reason", () => {
    const events: EmitInput[] = [];
    emitNewTicketSkipped(recordingBus(events), "preempted-by:confirmation");
    expect(events).toEqual([
      { type: "feature.new-ticket.skipped", reason: "preempted-by:confirmation" } as EmitInput,
    ]);
  });
});
