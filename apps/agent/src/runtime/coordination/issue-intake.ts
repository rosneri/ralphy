/**
 * RFC #402 — intake planning as a PURE derivation: classified candidates +
 * busy-set + ticket budget in, queue entries out. Eligibility, dependency
 * gating, the ticket cap, and bucket precedence (resume → mention → todo)
 * all live here as table-testable rules; the shell materializes the plan
 * (machine pickup events, queue pushes, logs).
 *
 * Ordering note: the returned entries keep bucket precedence only — the
 * shell still sorts the whole queue (including the scan's fix entries) with
 * `orderQueueEntries` afterwards, so auto-merge boost semantics are
 * unchanged.
 */
import type { TrackedIssue } from "@ralphy/tracker";
import { defaultPriorityFor, type MentionTrigger, type QueueEntry } from "../../queue/queue-order";

export interface IntakeCandidates {
  /** In-progress issues the shell already classified as resumable (not
   *  awaiting-ci, not feature-claimed, not promoted into a fix flow). */
  resumable: readonly TrackedIssue[];
  /** @ralphy mention triggers — become `review` runs. */
  mentions: readonly { issue: TrackedIssue; trigger: MentionTrigger }[];
  /** Fresh backlog. */
  todo: readonly TrackedIssue[];
}

export interface IntakeContext {
  /** Issues that must not be planned again: queued, active, mid-prepare, or
   *  claimed by a feature slice this poll. */
  busyIds: ReadonlySet<string>;
  /** How many more entries may be planned this poll. `Infinity` when
   *  `maxTickets` is unlimited. */
  budget: number;
}

export interface IntakePlan {
  entries: QueueEntry[];
  /** Issues skipped on an unresolved dependency (the tracker fetch already
   *  prunes resolved blockers, so any remaining blocker is genuinely open).
   *  Surfaced so the shell can log them. */
  blocked: TrackedIssue[];
}

/** Plan this poll's pickups. Buckets are walked in precedence order
 *  (resume → mention → todo); the first plan of an issue id wins; the budget
 *  is consumed across buckets. */
export function planIntake(candidates: IntakeCandidates, ctx: IntakeContext): IntakePlan {
  const entries: QueueEntry[] = [];
  const blocked: TrackedIssue[] = [];
  const planned = new Set<string>();
  let budget = ctx.budget;

  const eligible = (issue: TrackedIssue): boolean =>
    !ctx.busyIds.has(issue.id) && !planned.has(issue.id);

  for (const issue of candidates.resumable) {
    if (budget <= 0) break;
    if (!eligible(issue)) continue;
    if (issue.blockedByIds.length > 0) {
      blocked.push(issue);
      continue;
    }
    entries.push({ issue, trigger: "resume", priority: defaultPriorityFor("resume") });
    planned.add(issue.id);
    budget -= 1;
  }

  // Mentions intentionally skip the dependency gate: a human asked for a
  // review pass on this ticket, so a stale blocker link must not mute it.
  for (const { issue, trigger: mention } of candidates.mentions) {
    if (budget <= 0) break;
    if (!eligible(issue)) continue;
    entries.push({ issue, trigger: "review", priority: defaultPriorityFor("review"), mention });
    planned.add(issue.id);
    budget -= 1;
  }

  for (const issue of candidates.todo) {
    if (budget <= 0) break;
    if (!eligible(issue)) continue;
    if (issue.blockedByIds.length > 0) {
      blocked.push(issue);
      continue;
    }
    entries.push({ issue, trigger: "fresh", priority: defaultPriorityFor("fresh") });
    planned.add(issue.id);
    budget -= 1;
  }

  return { entries, blocked };
}
