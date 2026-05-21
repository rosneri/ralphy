import type { Bus, EmitInput } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.review-followup.*`
 *  events. Keeps the slice's emit surface consolidated so adding a new
 *  phase (or renaming an existing one) is a one-line change. */

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

export function emitWatermarkAdvanced(bus: Bus, from: string | null, to: string): void {
  emit(bus, "feature.review-followup.completed", {
    outcome: "watermark-advanced",
    ...(from ? { from } : {}),
    to,
  });
}

export function emitWatermarkUnchanged(bus: Bus, at: string): void {
  emit(bus, "feature.review-followup.skipped", { reason: "watermark-unchanged", at });
}
