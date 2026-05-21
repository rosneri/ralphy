import type { Bus, EmitInput } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.stuck.*` events.
 *  The slice does not act from the per-poll walk today; these helpers
 *  exist so wire / capability glue can route stuck-label observations
 *  through a per-feature surface without touching string literals from
 *  outside the slice. */

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

export function emitStuckSkipped(bus: Bus, reason: string): void {
  emit(bus, "feature.stuck.skipped", { reason });
}
