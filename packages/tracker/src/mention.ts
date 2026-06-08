/**
 * Per-issue review trigger emitted by mention scanning. Carries the comment
 * that should become the next task verbatim, so the worker doesn't have to
 * guess which of N comments matters.
 *
 * Extracted from `queue-order.ts` for RLF-223 (M1 — provider seam) so the
 * tracker-neutral {@link IssueTrackerProvider} surface can reference it
 * without depending on the agent's queue module. `queue-order.ts` keeps a
 * re-export so existing imports compile untouched.
 */
export interface MentionTrigger {
  /** Where the trigger originated.
   *  - "linear" / "github": an `@<handle>` mention on a comment.
   *  - "github-review": one or more unresolved review-thread comments on
   *     an open, unapproved PR. Body carries a pre-built digest. */
  source: "linear" | "github" | "github-review";
  body: string;
  createdAt: string;
  author?: string;
  url?: string;
}
