import type { Bus, EmitInput } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.ci-fix.*` events.
 *  Keeps the slice's emit surface consolidated so adding a new phase
 *  (or renaming an existing one) is a one-line change. */

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

export function emitCompleted(bus: Bus, outcome: string): void {
  emit(bus, "feature.ci-fix.completed", { outcome });
}

export function emitFailed(bus: Bus, error: string): void {
  emit(bus, "feature.ci-fix.failed", { error });
}
