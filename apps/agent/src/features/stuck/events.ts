import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.stuck.*` events.
 *  The slice does not act from the per-poll walk today; these helpers
 *  exist so wire / capability glue can route stuck-label observations
 *  through a per-feature surface without touching string literals from
 *  outside the slice. */

export function emitStuckSkipped(bus: Bus, reason: string): void {
  bus.emit({ type: "feature.stuck.skipped", reason });
}
