import type { Feature } from "../types";
import { detectConflictFix } from "./detect";
import { runConflictFix } from "./run";

/**
 * Conflict-fix vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). The conflict-fix trigger flows through the coordinator's
 * `runPrPhase` path — same as fresh/resume/review — so no feature-level
 * `postTask` is needed.
 */
export const conflictFixFeature: Feature = {
  id: "conflict-fix",
  ownedSlot: null,
  detect: detectConflictFix,
  run: runConflictFix,
};
