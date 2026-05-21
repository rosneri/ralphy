import type { Feature } from "../types";
import { detectNewTicket } from "./detect";
import { runNewTicket } from "./run";

/**
 * New-ticket vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns no `.ralph-state.json` slot. The coordinator's
 * fresh-todo arm still owns the queueing path until the stage-final
 * cleanup deletes it; the slice exists today as the typed descriptor
 * that holds the `feature.new-ticket.*` event surface.
 */
export const newTicketFeature: Feature = {
  id: "new-ticket",
  ownedSlot: null,
  detect: detectNewTicket,
  run: runNewTicket,
};

export { detectNewTicket, runNewTicket };
export { emitNewTicketSkipped } from "./events";
