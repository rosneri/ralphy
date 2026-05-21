import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The conflict-fix slice does NOT participate in the per-poll feature
 * walk over in-progress issues. Conflicted issues reach the queue via
 * the coordinator's separate `fetchConflicted` path (and via
 * `scanDoneForConflicts` for finished tickets), not via `detect`. So
 * `detect` here always returns `null` — the slice exists purely to
 * verify mergeability after each worker task finishes.
 */
export async function detectConflictFix(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
