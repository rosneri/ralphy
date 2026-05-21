import type { Feature } from "../types";
import { detectReviewFollowup } from "./detect";
import { runReviewFollowup } from "./run";

/**
 * Review-followup vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns the `review` slot in `.ralph-state.json` — its
 * state accessors are the single writer of `review.lastConsumedCommentAt`,
 * the watermark that `scanCodeReview` (`wire.ts`) consults so a stable
 * reviewer-comment list does not re-fire the review trigger every poll.
 *
 * The coordinator's `fetchReview` arm and the mention-scan path in
 * `wire.ts` still own the queueing logic until the stage-final cleanup
 * deletes them; both paths coexist safely because this slice is, for
 * now, just the state-ownership shell.
 */
export const reviewFollowupFeature: Feature = {
  id: "review-followup",
  ownedSlot: "review",
  detect: detectReviewFollowup,
  run: runReviewFollowup,
};

export { detectReviewFollowup, runReviewFollowup };
export { advanceWatermarkIfNewer, writeWatermark } from "./state";
export type { ReviewSlot } from "./state";
