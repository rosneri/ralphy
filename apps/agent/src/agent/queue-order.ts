import type { GetIndicator } from "@ralphy/types";
import type { LinearIssue } from "./linear";
import { issueMatchesGetIndicator } from "./linear";
import { chain, type Comparator } from "../sort/compare";

export type SpawnMode = "fresh" | "resume" | "conflict-fix" | "review";

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
  mode: SpawnMode;
  trigger?: MentionTrigger;
}

const MODE_RANK: Record<SpawnMode, number> = {
  resume: 0,
  "conflict-fix": 1,
  review: 2,
  fresh: 3,
};

/** Build the queue comparator. `getAutoMerge` (when provided) promotes
 *  conflict-fix entries whose issue matches the indicator to the head of
 *  the queue, ahead of every other priority. Order, in turn:
 *   1. Auto-merge boost (conflict-fix only)
 *   2. Linear priority (1=Urgent → 4=Low, 0=No-priority last)
 *   3. Spawn mode rank (resume < conflict-fix < review < fresh)
 *   4. createdAt asc (FIFO within a bucket)
 */
export function compareQueueEntries(
  getAutoMerge?: GetIndicator | undefined,
): Comparator<QueueEntry> {
  const isAutoMergeBoost = (e: QueueEntry): boolean =>
    e.mode === "conflict-fix" && issueMatchesGetIndicator(e.issue, getAutoMerge);
  return chain<QueueEntry>(
    (a, b) => Number(!isAutoMergeBoost(a)) - Number(!isAutoMergeBoost(b)),
    (a, b) => {
      const pa = a.issue.priority === 0 ? Infinity : a.issue.priority;
      const pb = b.issue.priority === 0 ? Infinity : b.issue.priority;
      return pa - pb;
    },
    (a, b) => MODE_RANK[a.mode] - MODE_RANK[b.mode],
    (a, b) => {
      const ca = a.issue.createdAt;
      const cb = b.issue.createdAt;
      if (ca === cb) return 0;
      return ca < cb ? -1 : 1;
    },
  );
}
