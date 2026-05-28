import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The review-followup slice does NOT participate in the per-poll feature
 * walk — review pickup runs through `fetchMentions` in the coordinator
 * and `scanCodeReview` in `wire.ts`. The slice exists to own the
 * `review.lastConsumedCommentAt` watermark slot, so `detect` always
 * returns `null`.
 */
export async function detectReviewFollowup(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
