import type { Bus } from "@ralphy/events";
import type { StateStore } from "../types";
import { emitWatermarkAdvanced, emitWatermarkUnchanged } from "./events";

/**
 * Typed accessor for the `review` slot in `.ralph-state.json`.
 *
 * The review-followup slice is the single writer of `state.review`.
 * `writeField` from `@ralphy/core/state` enforces the ownership invariant
 * at runtime — calls from any other feature throw `OwnershipError` before
 * touching disk.
 */
export interface ReviewSlot {
  /** ISO timestamp of the most recent reviewer activity Ralph has acted
   *  on. Used by `scanCodeReview` (`wire.ts`) to suppress re-firing the
   *  review trigger when the reviewer's comment list hasn't advanced. */
  lastConsumedCommentAt?: string;
}

/** Write the watermark unconditionally. Most callers should prefer
 *  `advanceWatermarkIfNewer` so a stale candidate cannot rewind the
 *  watermark. */
export async function writeWatermark(state: StateStore, at: string): Promise<void> {
  await state.writeField("review.lastConsumedCommentAt", at);
}

/**
 * Advance the watermark to `candidate` only when it is strictly newer
 * than `current`. Returns `true` when a write happened, `false` when
 * the candidate is older-or-equal and we skipped. Emits a
 * `feature.review-followup.*` event so callers don't have to thread
 * the bus through every comparison site.
 */
export async function advanceWatermarkIfNewer(
  state: StateStore,
  bus: Bus,
  current: string | null,
  candidate: string,
): Promise<boolean> {
  if (current !== null && candidate <= current) {
    emitWatermarkUnchanged(bus, current);
    return false;
  }
  await writeWatermark(state, candidate);
  emitWatermarkAdvanced(bus, current, candidate);
  return true;
}
