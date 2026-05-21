import type { Bus } from "@ralphy/events";

/** Thin typed helpers around `bus.emit` for `feature.new-ticket.*`
 *  events. The slice does not act from the per-poll walk today; these
 *  helpers exist so wire can route `agent_worker_spawned` for fresh
 *  tickets through a per-feature surface without touching string
 *  literals from outside the slice. */

export function emitNewTicketSkipped(bus: Bus, reason: string): void {
  bus.emit({ type: "feature.new-ticket.skipped", reason });
}
