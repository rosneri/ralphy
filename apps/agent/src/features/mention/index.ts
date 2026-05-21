import type { Feature } from "../types";
import { detectMention } from "./detect";
import { runMention } from "./run";

/**
 * Mention vertical slice.
 *
 * Does not participate in the per-poll feature walk (`detect` always
 * returns `null`). Owns no `.ralph-state.json` slot — by design: the
 * boundary spec forbids this slice from writing `state.confirmation`,
 * and it has no slot of its own. Mention signals are surfaced as bus
 * events (`feature.mention.reviseComment`) that the confirmation slice
 * consumes; centralizing the cross-feature seam on the bus keeps slices
 * independently shippable and grep-able.
 *
 * The mention-scan path in `wire.ts` and the coordinator's mention arm
 * still own the queueing logic until the stage-final cleanup deletes
 * them.
 */
export const mentionFeature: Feature = {
  id: "mention",
  ownedSlot: null,
  detect: detectMention,
  run: runMention,
};

export { emitMentionReviseComment, emitMentionSkipped } from "./events";
