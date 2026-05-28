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
