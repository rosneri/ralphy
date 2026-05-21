import type { Feature } from "../types";
import { detectStuck } from "./detect";
import { runStuck } from "./run";

/**
 * Stuck vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns no `.ralph-state.json` slot. The `applyStuckLabel`
 * capability invoked from the worker (`wire.ts`) still owns the legacy
 * stuck-flagging path; the slice exists today as the typed descriptor
 * that holds the `feature.stuck.*` event surface so future extraction
 * can drop the legacy branch in one step.
 */
export const stuckFeature: Feature = {
  id: "stuck",
  ownedSlot: null,
  detect: detectStuck,
  run: runStuck,
};

export { emitStuckSkipped } from "./events";
