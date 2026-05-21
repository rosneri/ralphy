import { describe, expect, test } from "bun:test";
import type { EmitInput } from "@ralphy/events";
import { newTicketFeature, emitNewTicketSkipped } from "../index";
import { recordingBus, makeBareCtx } from "../../../__test-utils__/recording-bus";

describe("new-ticket feature", () => {
  test("descriptor: id, ownedSlot null", () => {
    expect(newTicketFeature.id).toBe("new-ticket");
    expect(newTicketFeature.ownedSlot).toBeNull();
  });

  test("detect returns null — slice never claims the per-poll walk", async () => {
    const ctx = makeBareCtx();
    expect(await newTicketFeature.detect(ctx)).toBeNull();
  });

  test("run is a no-op (resolves without touching ctx)", async () => {
    const ctx = makeBareCtx();
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
