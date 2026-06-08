import { buildRalphyComment } from "@ralphy/comms";

export interface MentionInputs {
  comments: Array<{ body: string; isRalph: boolean }>;
  triggerPhrase: string;
}

/**
 * True when any non-Ralph comment contains triggerPhrase as a
 * case-insensitive substring. Ralph-authored comments are skipped.
 */
export function hasMentionTrigger(inputs: MentionInputs): boolean {
  const needle = inputs.triggerPhrase.toLowerCase();
  return inputs.comments.some((c) => !c.isRalph && c.body.toLowerCase().includes(needle));
}

export function buildMentionAckComment(body: string, author?: string): string {
  const firstLine = body.split("\n")[0]!;
  const truncated = firstLine.slice(0, 200);
  const excerpt = truncated + (truncated.length < firstLine.length ? "…" : "");
  const greeting = author
    ? `Got it, ${author} — picked up your mention and queued a review pass.`
    : `Acknowledged — picked up your mention and queued a review pass.`;
  return buildRalphyComment({
    type: "mention-ack",
    action: "picked up your mention",
    body: `${greeting}\n\n> ${excerpt}`,
  });
}
