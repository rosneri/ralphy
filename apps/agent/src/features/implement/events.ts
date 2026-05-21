import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.implement.*` events.
 *  Keeps the slice's emit surface consolidated so adding a new phase
 *  (or renaming an existing one) is a one-line change. */

export function emitCompleted(bus: Bus, outcome: string, prUrl: string | null): void {
  bus.emit({ type: "feature.implement.completed", outcome, ...(prUrl ? { prUrl } : {}) });
}

export function emitFailed(bus: Bus, error: string): void {
  bus.emit({ type: "feature.implement.failed", error });
}
