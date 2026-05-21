import type { Feature } from "../types";
import { detectConflictFix } from "./detect";
import { runConflictFix } from "./run";
import { conflictFixPostTask } from "./postTask";

/**
 * Conflict-fix vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns no state slot — mergeability is read on-demand
 * via `caps.conflictFix`. The only meaningful entry point is `postTask`,
 * which verifies the PR is still mergeable after a worker iteration and
 * emits `feature.conflict-fix.{completed,failed}` accordingly.
 *
 * The legacy conflict-fix arm in `coordinator.ts` (trigger queueing,
 * setConflicted promotion, comment posting) and the conflict-resolution
 * loop in `post-task.ts` (`fixConflictsAndCiLoop` wantConflictLoop
 * branch) remain in place until the final cleanup task in this stage
 * deletes them; both paths coexist safely because this slice's
 * `postTask` is a side-effect-free verifier.
 */
export const conflictFixFeature: Feature = {
  id: "conflict-fix",
  ownedSlot: null,
  detect: detectConflictFix,
  run: runConflictFix,
  postTask: conflictFixPostTask,
};
