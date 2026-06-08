/**
 * Post Linear comments for self-review round transitions.
 *
 * Called after each review pass completes. The comment text encodes the
 * outcome so Linear surfaces progress without the reviewer needing to open
 * the change directory:
 *
 *   🔎 N findings — looping back for a fix cycle
 *   ✅ no findings — review passed, proceeding to done
 *   ⚠️ cap reached — N open finding(s) remain; attaching review-findings.md
 */

import { buildRalphyComment } from "@ralphy/comms";

export interface ReviewCommentDeps {
  apiKey: string;
  issueId: string;
  changeName: string;
  log: (text: string, color?: string) => void;
  createIssueComment: (apiKey: string, issueId: string, body: string) => Promise<string>;
}

export interface ReviewRoundCommentInput {
  openFindings: number;
  roundNumber: number;
  capReached: boolean;
  findingsContent: string | null;
}

/**
 * Format the comment body for a review round transition.
 */
export function formatReviewRoundComment(
  changeName: string,
  input: ReviewRoundCommentInput,
): string {
  const { openFindings, roundNumber, capReached } = input;
  const prefix = `**[${changeName}] Self-review round ${roundNumber}**`;

  let detail: string;
  if (capReached && openFindings > 0) {
    const findings = input.findingsContent
      ? `\n\n**Open findings:**\n\`\`\`\n${input.findingsContent.trim()}\n\`\`\``
      : "";
    detail = `${prefix}\n\n⚠️ Cap reached — ${openFindings} open finding(s) remain. Proceeding to done.${findings}`;
  } else if (openFindings === 0) {
    detail = `${prefix}\n\n✅ No findings — review passed. Proceeding to done.`;
  } else {
    detail = `${prefix}\n\n🔎 ${openFindings} finding(s) — looping back for a fix cycle.`;
  }

  return buildRalphyComment({
    type: "review-round",
    action: `self-review round ${roundNumber}`,
    body: detail,
    fields: { change: changeName, round: roundNumber, open: openFindings },
  });
}

/**
 * Post a Linear comment for a review round transition.
 */
export async function postReviewRoundComment(
  deps: ReviewCommentDeps,
  input: ReviewRoundCommentInput,
): Promise<void> {
  const body = formatReviewRoundComment(deps.changeName, input);
  try {
    await deps.createIssueComment(deps.apiKey, deps.issueId, body);
    deps.log(
      `  review-comment: posted round ${input.roundNumber} comment for ${deps.changeName}`,
      "gray",
    );
  } catch (err) {
    deps.log(`! review-comment: failed to post comment: ${(err as Error).message}`, "yellow");
  }
}
