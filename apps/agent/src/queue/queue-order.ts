import type { GetIndicator } from "@ralphy/types";
import type { LinearIssue } from "../agent/linear";
import { issueMatchesGetIndicator } from "../agent/linear";
import { chain, type Comparator } from "../sort/compare";

/** Semantic origin of a queued issue. Carries intent for logging, comment
 *  posting and label flow; does NOT influence ordering — that's `priority`. */
export type QueueTrigger = "fresh" | "resume" | "conflict-fix" | "ci-fix" | "review";

/** Per-issue review trigger emitted by mention scanning. Carries the
 *  comment that should become the next task verbatim, so the worker
 *  doesn't have to guess which of N comments matters. */
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

export interface QueueEntry {
  issue: LinearIssue;
  trigger: QueueTrigger;
  /** Lower wins. Computed at enqueue time from the trigger semantics
   *  (resume=0, conflict-fix=1, ci-fix=2, review=3, fresh=4). Sort uses
   *  this number directly so trigger has no ordering coupling. */
  priority: number;
  mention?: MentionTrigger;
}

/** Default priority for a given trigger. Callers compute this when
 *  pushing to the queue so the comparator stays decoupled from the
 *  enum's string values. */
export function defaultPriorityFor(trigger: QueueTrigger): number {
  switch (trigger) {
    case "resume":
      return 0;
    case "conflict-fix":
      return 1;
    case "ci-fix":
      return 2;
    case "review":
      return 3;
    case "fresh":
      return 4;
  }
}

/** Build the queue comparator. `getAutoMerge` (when provided) promotes
 *  conflict-fix entries whose issue matches the indicator to the head of
 *  the queue, ahead of every other priority. Order, in turn:
 *   1. Auto-merge boost (conflict-fix only)
 *   2. Linear priority (1=Urgent → 4=Low, 0=No-priority last)
 *   3. Numeric `priority` field (lower first)
 *   4. createdAt asc (FIFO within a bucket)
 */
export function compareQueueEntries(
  getAutoMerge?: GetIndicator | undefined,
): Comparator<QueueEntry> {
  const isAutoMergeBoost = (e: QueueEntry): boolean =>
    e.trigger === "conflict-fix" && issueMatchesGetIndicator(e.issue, getAutoMerge);
  return chain<QueueEntry>(
    (a, b) => Number(!isAutoMergeBoost(a)) - Number(!isAutoMergeBoost(b)),
    (a, b) => {
      const pa = a.issue.priority === 0 ? Infinity : a.issue.priority;
      const pb = b.issue.priority === 0 ? Infinity : b.issue.priority;
      return pa - pb;
    },
    (a, b) => a.priority - b.priority,
    (a, b) => {
      const ca = a.issue.createdAt;
      const cb = b.issue.createdAt;
      if (ca === cb) return 0;
      return ca < cb ? -1 : 1;
    },
  );
}
