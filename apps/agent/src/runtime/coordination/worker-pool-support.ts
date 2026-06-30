/**
 * RFC #402 — pure support for {@link WorkerPool}: the spawn/prepare shapes,
 * the pool dependency and option interfaces, the {@link completionCommentBody}
 * outcome builder, the trigger→flow id mapping, and the {@link whenSettled}
 * stability constant. Split out so `worker-pool.ts` carries only the live
 * pool object and its lifecycle methods.
 */
import type { SetIndicator } from "@ralphy/types";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { Bus } from "@ralphy/events";
import type { FlowDirector, FlowId, FlowRef } from "@ralphy/core/machines";
import { buildRalphyComment } from "@ralphy/comms";
import type { MentionTrigger, QueueEntry, QueueTrigger } from "../../queue/queue-order";
import type { ActiveWorker } from "../types";

/** Spawn shape — same as before. */
export interface WorkerHandle {
  exited: Promise<number>;
  kill: () => void;
}

/** Result of a `prepare` step. The wire layer is responsible for the side
 *  effects (scaffold, worktree create-or-resume, fix-task prepend, state
 *  reactivation) — the pool only sees the change name back. */
export interface PrepareResult {
  changeName: string;
  /** Optional: PR URL the spawn should reference (used for conflict-fix runs). */
  prUrl?: string;
  /** Working directory the worker runs in (the worktree when useWorktree is
   *  on). Carried onto the ActiveWorker so post-exit syncTasks flushes can
   *  resolve change artifacts after the wire layer has released its
   *  per-change maps. */
  cwd?: string;
}

/** Number of consecutive macrotask hops {@link WorkerPool.whenSettled}
 *  must observe an empty in-flight set before it concludes the system is idle.
 *  A worker's finalization enrolls only after its exit promise resolves, and
 *  under load that resolve→enroll chain can span more than one macrotask hop;
 *  requiring several stable observations closes that window without ever
 *  hanging on a still-running worker. Test-only barrier. */
export const WHEN_SETTLED_STABLE_HOPS = 3;

/** Build the Linear comment for a finished worker. Split out to keep the
 *  outcomes (no-op done / quarantined failure / conflict-fix / ci-fix /
 *  deferred-awaiting / genuinely-done) as a flat branch rather than nested
 *  ternaries.
 *
 *  `reachedDone` is the flow actor's post-exit state — `true` only when the
 *  machine actually transitioned to `done`. When a PR is open and recovery is
 *  enabled the actor rests in `awaiting-ci` instead (the watcher owns the
 *  move to done once the PR is genuinely mergeable), so the comment must NOT
 *  claim "completed work" — it reports the real, awaiting state instead. This
 *  is the single guard that stops a fix/review iteration from announcing
 *  completion while the PR is still draft, red, unapproved, or unmerged. */
export function completionCommentBody(args: {
  noChanges: boolean;
  ok: boolean;
  trigger: QueueTrigger;
  changeName: string;
  code: number;
  /** Flow actor reached the terminal `done` state after this exit. */
  reachedDone: boolean;
}): string {
  const { noChanges, ok, trigger, changeName, code, reachedDone } = args;
  if (noChanges) {
    return buildRalphyComment({
      type: "completed-noop",
      action: "completed — no code changes",
      body:
        `Completed all tasks for this issue but produced no code changes — the requested ` +
        `work appears to already be present on the base branch (or was a no-op). No PR was ` +
        `opened. Change: \`${changeName}\`\n\n` +
        `Marking this done; please verify the work is genuinely in place. If it is not, ` +
        `reopen the issue with more specifics.`,
      fields: { change: changeName },
    });
  }
  if (!ok) {
    return buildRalphyComment({
      type: "exited",
      action: `exited with code ${code}`,
      body:
        `This issue has been quarantined and will not be auto-resumed on the next poll. ` +
        `Inspect the worktree at \`~/.ralph/<project>/worktrees/${changeName}\`, fix the ` +
        `underlying failure, then remove the error marker on this Linear issue (or run ` +
        `\`ralph clean --name ${changeName}\`) to clear the quarantine. Change: \`${changeName}\``,
      fields: { change: changeName, code },
    });
  }
  if (trigger === "conflict-fix") {
    return buildRalphyComment({
      type: "conflicts-resolved",
      action: "resolved merge conflicts",
      body: `Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  if (trigger === "ci-fix") {
    // A ci-fix iteration pushed a fix but has NOT re-verified CI — the watcher
    // re-checks the PR on the next poll. Announcing "completed work" here is
    // what made a still-red PR look done; report the honest in-flight state.
    return buildRalphyComment({
      type: "ci-fix-pushed",
      action: "pushed a CI fix",
      body:
        `Pushed a fix for the failing CI on this PR — re-checking the checks on the ` +
        `next poll before marking this done. Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  if (!reachedDone) {
    // PR is open and recovery is enabled, so the ticket rests in `awaiting-ci`
    // — the watcher advances it to done only once the PR is genuinely mergeable
    // (non-draft, approved, CI-green, no conflicts). This is NOT "completed
    // work": the work is pushed but the PR is not ready yet.
    const isReview = trigger === "review";
    return buildRalphyComment({
      type: "awaiting-ci",
      action: isReview ? "addressed review feedback" : "opened a PR",
      body:
        (isReview
          ? `Pushed changes for the review feedback to this PR. `
          : `Finished the work and opened a PR. `) +
        `Awaiting CI, review, and a clean merge state before marking this done. ` +
        `Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  return buildRalphyComment({
    type: "completed",
    action: "completed work",
    body: `Change: \`${changeName}\``,
    fields: { change: changeName },
  });
}

export function triggerToFlowId(trigger: QueueTrigger): FlowId {
  if (trigger === "conflict-fix") return "conflict-fix";
  if (trigger === "ci-fix") return "ci-fix";
  if (trigger === "review") return "review-followup";
  return "implement";
}

export interface WorkerPoolDeps {
  prepare: (issue: TrackedIssue) => Promise<PrepareResult>;
  prepareTaskForTrigger?:
    | ((
        issue: TrackedIssue,
        changeName: string,
        trigger: QueueTrigger,
        mention?: MentionTrigger,
      ) => Promise<void>)
    | undefined;
  spawnWorker: (changeName: string, issue: TrackedIssue, trigger: QueueTrigger) => WorkerHandle;
  applyIndicator: IssueTrackerProvider["applyIndicator"];
  removeIndicator: IssueTrackerProvider["removeIndicator"];
  postComment: IssueTrackerProvider["postComment"];
  fetchComments: IssueTrackerProvider["fetchComments"];
  hasPrForChange?: ((changeName: string) => boolean) | undefined;
  getIterationCount?: ((changeName: string) => Promise<number>) | undefined;
  syncTasks?: ((worker: ActiveWorker, iteration: number) => Promise<void>) | undefined;
  onLog: (text: string, color?: string) => void;
  onWorkersChanged: () => void;
  bus: Bus;
  director: FlowDirector;
  flowRef: (issue: TrackedIssue) => FlowRef;
  /** Pull the next queue entry when a slot frees. The queue stays with the
   *  shell — ordering is its behavior. */
  dequeue: () => QueueEntry | undefined;
  /** Push a steering-restart resume back to the FRONT of the queue. */
  requeueFront: (entry: QueueEntry) => void;
}

export interface WorkerPoolOpts {
  concurrency: number;
  setInProgress?: SetIndicator | undefined;
  setDone?: SetIndicator | undefined;
  setError?: SetIndicator | undefined;
  postComments?: boolean | undefined;
  maxTickets?: number | undefined;
  createsPrs?: boolean | undefined;
  prRecovery?: { enabled: boolean } | undefined;
}
