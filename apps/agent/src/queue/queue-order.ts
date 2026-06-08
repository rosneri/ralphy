import type { GetIndicator } from "@ralphy/types";
import { type OrderableIssue, orderIssuesHierarchically } from "@ralphy/core/ordering";
import { issueMatchesGetIndicator } from "../agent/linear";
import type { MentionTrigger, TrackedIssue } from "@ralphy/tracker";

/** Re-exported from `@ralphy/tracker` (RLF-223 M1). Kept here so the existing
 *  imports from `queue-order` / the coordinator re-export compile untouched. */
export type { MentionTrigger };

/** Semantic origin of a queued issue. Carries intent for logging, comment
 *  posting and label flow; does NOT influence ordering — that's `priority`. */
export type QueueTrigger = "fresh" | "resume" | "conflict-fix" | "ci-fix" | "review";

export interface QueueEntry {
  issue: TrackedIssue;
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

/** Whether an entry is an auto-merge-boosted conflict-fix: a conflict-fix
 *  whose issue matches the `getAutoMerge` indicator. These jump the queue
 *  ahead of every hierarchically-ordered entry. */
function isAutoMergeBoost(e: QueueEntry, getAutoMerge?: GetIndicator | undefined): boolean {
  return e.trigger === "conflict-fix" && issueMatchesGetIndicator(e.issue, getAutoMerge);
}

/** Project a {@link TrackedIssue} onto the pure {@link OrderableIssue} shape
 *  consumed by `orderIssuesHierarchically`. Shared by the queue builder and the
 *  `agent list` command so both order issues identically. `tiebreak`, when
 *  provided, is threaded as the item-level sub-tiebreak (the queue passes the
 *  trigger `priority`); the list omits it. */
export function linearIssueToOrderable(issue: TrackedIssue, tiebreak?: number): OrderableIssue {
  return {
    id: issue.id,
    ...(issue.project
      ? {
          project: {
            id: issue.project.id,
            ...(issue.project.priority !== undefined ? { priority: issue.project.priority } : {}),
          },
        }
      : {}),
    ...(issue.milestone
      ? {
          milestone: {
            id: issue.milestone.id,
            sortOrder: issue.milestone.sortOrder,
            ...(issue.milestone.targetDate ? { targetDate: issue.milestone.targetDate } : {}),
          },
        }
      : {}),
    priority: issue.priority,
    ...(tiebreak !== undefined ? { tiebreak } : {}),
    blockedByIds: issue.blockedByIds,
    createdAt: issue.createdAt,
  };
}

/** `OrderableIssue` carrying its source `QueueEntry`, so the hierarchical
 *  order can be mapped straight back to entries. */
interface QueueOrderable extends OrderableIssue {
  entry: QueueEntry;
}

/** Project the queue entry's Linear issue onto the {@link OrderableIssue}
 *  shape, threading the trigger `priority` as the item-level tiebreak so
 *  resume/conflict-fix beat fresh among items of equal Linear priority. */
function toOrderable(entry: QueueEntry): QueueOrderable {
  return { ...linearIssueToOrderable(entry.issue, entry.priority), entry };
}

/**
 * Order a list of entries hierarchically (project → milestone → item), while
 * preserving *every* entry — including multiple entries that target the same
 * issue id (e.g. a ci-fix and a mention-review for one ticket).
 *
 * `orderIssuesHierarchically` keys its internal maps by issue id, so feeding it
 * duplicate ids would collapse them and drop entries. We instead order the set
 * of *distinct* issues to obtain a per-issue rank, then stable-sort the full
 * entry list by that rank. Duplicates of one issue share a rank and fall back
 * to trigger `priority` (lower first) — so the highest-priority trigger spawns
 * first while the rest stay queued, matching the prior comparator's behaviour.
 */
function orderEntries(entries: QueueEntry[]): QueueEntry[] {
  if (entries.length <= 1) return entries.slice();

  // One representative OrderableIssue per distinct issue id, keeping the
  // entry with the strongest trigger so the issue is positioned as its
  // highest-priority work would place it.
  const repByIssue = new Map<string, QueueOrderable>();
  for (const entry of entries) {
    const orderable = toOrderable(entry);
    const existing = repByIssue.get(orderable.id);
    if (!existing || orderable.tiebreak! < existing.tiebreak!) {
      repByIssue.set(orderable.id, orderable);
    }
  }

  const rankOf = new Map<string, number>();
  orderIssuesHierarchically([...repByIssue.values()]).forEach((o, i) => rankOf.set(o.id, i));

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ra = rankOf.get(a.entry.issue.id)!;
      const rb = rankOf.get(b.entry.issue.id)!;
      if (ra !== rb) return ra - rb;
      // Same issue (duplicate entries): strongest trigger first, then stable.
      if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
      return a.index - b.index;
    })
    .map((x) => x.entry);
}

/** Order the queue. Auto-merge-boosted conflict-fix entries sort ahead of
 *  every other entry (themselves hierarchically ordered); everything else
 *  follows project priority → milestone topo order → item priority, with the
 *  trigger `priority` as the sub-tiebreak among equal items.
 *
 *  Returns a new array; the input is not mutated. */
export function orderQueueEntries(
  entries: QueueEntry[],
  getAutoMerge?: GetIndicator | undefined,
): QueueEntry[] {
  const boosted: QueueEntry[] = [];
  const rest: QueueEntry[] = [];
  for (const e of entries) {
    if (isAutoMergeBoost(e, getAutoMerge)) boosted.push(e);
    else rest.push(e);
  }
  return [...orderEntries(boosted), ...orderEntries(rest)];
}
