import type { StateStore } from "../types";

/**
 * The awaiting-ci slice does not own a `.ralph-state.json` slot — it
 * only reads `state.pr.flow` (written by the implement slice when it
 * transitions). This module exists so the slice's read-shape stays
 * centralised; the runtime parameter is unused today but kept for
 * symmetry with sibling slices.
 */
export interface AwaitingCiSlotView {
  /** Last observed flow id stored on the pr slot (read-only). */
  flow?: "awaiting-ci";
}

export function readState(_state: StateStore): AwaitingCiSlotView {
  return {};
}
