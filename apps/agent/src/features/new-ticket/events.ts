import type { Bus, EmitInput } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.new-ticket.*`
 *  events. The slice does not act from the per-poll walk today; these
 *  helpers exist so wire can route `agent_worker_spawned` for fresh
 *  tickets through a per-feature surface without touching string
 *  literals from outside the slice. */

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

export function emitNewTicketSkipped(bus: Bus, reason: string): void {
  emit(bus, "feature.new-ticket.skipped", { reason });
}
