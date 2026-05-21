import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.awaiting-ci.*` events.
 *  The slice's only outputs are these two emit shapes. */

export function emitCompleted(bus: Bus, outcome: "pass" | "pending" | "unknown"): void {
  bus.emit({ type: "feature.awaiting-ci.completed", outcome });
}

export function emitFailed(bus: Bus, error: string): void {
  bus.emit({ type: "feature.awaiting-ci.failed", error });
}
