import type { BoostBand } from "@ralphy/core/machines";
import type { TrackedIssue } from "@ralphy/tracker";
import type { QueueTrigger } from "../queue/queue-order";

export type { BoostBand };

/** One live worker subprocess tracked by the coordinator. */
export interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  issue: TrackedIssue;
  trigger: QueueTrigger;
  /** Worker working directory from {@link PrepareResult.cwd}. Lets the
   *  awaiting-reap / done syncTasks flush read the change artifacts from the
   *  worktree even after the wire layer's exit handler has already cleared
   *  `cwdByChange` (otherwise the flush silently falls back to projectRoot,
   *  where the change files may not exist — no design attachment uploaded). */
  cwd?: string;
  kill: () => void;
  /** Highest iteration count we've already posted a progress comment for. */
  lastReportedIteration: number;
  /** Iteration count last passed to `syncTasks`. Lets the poll loop skip
   *  re-syncing when the worker hasn't ticked a new iteration. Initialized
   *  to 0 on spawn since the launch path syncs iteration 0 immediately. */
  lastSyncedIteration: number;
  /** Artifact fingerprint last passed to `syncTasks` (via
   *  `getTasksFingerprint`). The poll loop gates on this when the dep is
   *  wired, so mid-iteration `tasks.md` ticks sync at poll cadence. Left
   *  unchanged on sync failure so the next poll retries. Initialized to
   *  `null`; the first poll captures the launch-time fingerprint. */
  lastSyncedTasksFingerprint: string | null;
  /** Set by `restartWorker` so the exit handler skips notifyExited and
   *  re-queues the worker as a resume instead of finalizing the issue. */
  restarting: boolean;
  /** Set by `reapForAwaiting` when the coordinator kills the worker
   *  because the ticket has flipped into `awaiting-confirmation`. The
   *  exit handler skips notifyExited (no setError, no setDone) and does
   *  NOT re-queue — the ticket will be resumed on a future poll once the
   *  gate clears (approval or revise comment). */
  reapedForAwaiting: boolean;
}
