import type { MentionTrigger } from "../../queue/queue-order";
export { isRalphComment } from "../../shared/utils/ralph-comment";

/** Format reviewer comments as a fix-task body. Each comment becomes a
 *  fenced block with the author + timestamp header so the worker can see
 *  who said what. Empty input falls back to a "no new comments" stub so
 *  the worker still gets a deterministic task entry. */
export function buildReviewTaskBody(
  comments: {
    body: string;
    createdAt: string;
    user: { name: string; email: string | null } | null;
  }[],
  url: string,
): string {
  if (comments.length === 0) {
    return `No non-Ralph reviewer comments were found on ${url}. Recheck the issue manually before continuing.`;
  }
  const blocks = comments.map((c) => {
    const author = c.user?.name ?? "unknown";
    return `**${author}** — ${c.createdAt}\n\n${c.body.trim()}`;
  });
  return [
    `Reviewer comments left on the Linear issue (${url}):`,
    "",
    ...blocks,
    "",
    "Address every concrete request above. If a comment is ambiguous, note",
    "your interpretation in proposal.md `## Steering` before acting.",
  ].join("\n");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Format a single mention as the prepended task body. Includes the
 *  comment author, timestamp, source, and a permalink so the worker can
 *  cross-reference if more context is needed. */
export function buildMentionTaskBody(trigger: MentionTrigger, issueUrl: string): string {
  if (trigger.source === "github-review") {
    // Body was pre-built as a digest by fetchCodeReviewThreads — frame it
    // with the resolution workflow so the worker knows the contract.
    return [
      `Open code-review on ${trigger.url ?? issueUrl} has unresolved comments:`,
      "",
      trigger.body.trim(),
      "",
      "For every comment above, decide:",
      "- If you agree, fix the code, commit, and push. The push will surface",
      "  the new commit on the PR; the worker should then resolve the thread",
      "  via `gh api graphql` (`resolveReviewThread`) — see GitHub docs.",
      "- If you disagree, post a polite reply on the thread explaining your",
      "  reasoning via `gh api repos/{owner}/{repo}/pulls/{num}/comments/{id}/replies`,",
      "  and leave the thread unresolved.",
      "",
      "When this round is done the loop exits; the agent will re-poll the",
      "PR on the next cycle and pick up any new reviewer activity until the",
      "PR is approved or merged.",
    ].join("\n");
  }
  const sourceLabel = trigger.source === "github" ? "GitHub PR" : "Linear issue";
  const permalink = trigger.url ?? issueUrl;
  const header = `${trigger.author ?? "unknown"} — ${trigger.createdAt} (${sourceLabel})`;
  return [
    `An @ralphy mention was left on ${sourceLabel} (${permalink}):`,
    "",
    `**${header}**`,
    "",
    trigger.body.trim(),
    "",
    "Treat this comment as the next concrete request. If it's ambiguous,",
    "note your interpretation in proposal.md `## Steering` before acting.",
  ].join("\n");
}

/** Newest ISO timestamp from Ralph's `🔁 picked up` review acks, or null. */
export function findLastRalphPickupISO(
  comments: { body: string; createdAt: string }[],
): string | null {
  let latest: string | null = null;
  for (const c of comments) {
    if (!/^🔁\s*Ralph picked up/.test(c.body.trimStart())) continue;
    if (latest === null || c.createdAt > latest) latest = c.createdAt;
  }
  return latest;
}

export function stripCodeMarkup(s: string): string {
  return s.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");
}

export function containsHandle(body: string, handle: string): boolean {
  const re = new RegExp(`(^|\\s|[^A-Za-z0-9_])${escapeRegex(handle)}\\b`, "i");
  return re.test(stripCodeMarkup(body));
}

/** Map a unicode emoji to GitHub's reactions API `content` slug. */
export function githubReactionSlug(emoji: string): string {
  switch (emoji) {
    case "👀":
      return "eyes";
    case "👍":
      return "+1";
    case "👎":
      return "-1";
    case "❤️":
      return "heart";
    case "🎉":
      return "hooray";
    case "🚀":
      return "rocket";
    case "😄":
      return "laugh";
    case "😕":
      return "confused";
    default:
      return emoji;
  }
}
