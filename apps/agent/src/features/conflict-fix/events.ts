import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.conflict-fix.*`
 *  events. Keeps the slice's emit surface consolidated so adding a new
 *  phase (or renaming an existing one) is a one-line change. */

export function emitCompleted(bus: Bus, outcome: string): void {
  bus.emit({ type: "feature.conflict-fix.completed", outcome });
}

export function emitFailed(bus: Bus, error: string): void {
  bus.emit({ type: "feature.conflict-fix.failed", error });
}
