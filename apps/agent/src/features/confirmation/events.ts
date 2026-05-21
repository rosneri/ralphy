import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.confirmation.*`
 *  events. Keeps the slice's emit surface consolidated so adding a new
 *  phase (or renaming an existing one) is a one-line change. */

export function emitDetected(bus: Bus, reason: string): void {
  bus.emit({ type: "feature.confirmation.detected", reason });
}

export function emitSkipped(bus: Bus, reason: string): void {
  bus.emit({ type: "feature.confirmation.skipped", reason });
}

export function emitCompleted(bus: Bus, outcome: string): void {
  bus.emit({ type: "feature.confirmation.completed", outcome });
}

export function emitFailed(bus: Bus, error: string): void {
  bus.emit({ type: "feature.confirmation.failed", error });
}
