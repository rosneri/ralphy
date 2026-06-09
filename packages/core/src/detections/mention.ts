import { buildRalphyComment, isRalphyComment } from "@ralphy/comms";

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

export function buildMentionAckComment(_body: string, author?: string): string {
  const greeting = author
    ? `Got it, ${author} — picked up your mention and queued a review pass.`
    : `Acknowledged — picked up your mention and queued a review pass.`;
  return buildRalphyComment({
    type: "mention-ack",
    action: "picked up your mention",
    body: greeting,
  });
}
