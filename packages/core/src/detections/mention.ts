import { buildRalphyMarker, isRalphyComment } from "@ralphy/comms";

export interface MentionInputs {
  comments: Array<{ body: string; isRalph: boolean }>;
  triggerPhrase: string;
}

/**
 * True when any human comment contains triggerPhrase as a case-insensitive
 * substring. A comment is skipped when the caller flags it `isRalph` OR when
 * its body is recognised as a Ralphy-emitted message by the unified
 * `isRalphyComment` marker — so Ralphy's own acknowledgments can never count as
 * a mention even if `isRalph` is mis-set or omitted (closes the re-ack loop).
 */
export function hasMentionTrigger(inputs: MentionInputs): boolean {
  const needle = inputs.triggerPhrase.toLowerCase();
  return inputs.comments.some(
    (c) => !c.isRalph && !isRalphyComment(c.body) && c.body.toLowerCase().includes(needle),
  );
}

/**
 * The mention acknowledgment. The visible feedback is the 👀 reaction the scan
 * adds to the human's mention comment; the comment Ralphy posts is *only* the
 * hidden marker (an HTML comment, invisible in the tracker UI), so it adds no
 * prose noise while still serving as the dedup watermark that
 * {@link isMentionAckComment} / `findLastMentionAckISO` use to close the
 * re-ack-every-poll loop.
 */
export function buildMentionAckComment(): string {
  return buildRalphyMarker("mention-ack", { status: "handled" });
}
