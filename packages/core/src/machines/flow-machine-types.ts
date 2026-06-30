import type { Bus } from "@ralphy/events";

export type FlowId =
  | "confirmation"
  | "conflict-fix"
  | "ci-fix"
  | "awaiting-ci"
  | "review-followup"
  | "implement"
  | "new-ticket"
  | "mention"
  | "stuck"
  | "idle";

export type BoostBand = "p0" | "p1" | "p2" | "p3";

export interface FlowAssignment {
  flowId: FlowId;
  reason: string;
  boost: BoostBand;
}

export interface FlowWorker {
  exited: Promise<number | null>;
  kill: (signal?: "SIGTERM" | "SIGKILL") => void;
}

type TeardownReason = "cancelled" | "done" | "failed";
export type Teardown = (reason: TeardownReason) => Promise<void> | void;

export type FailureReason = "conflicting" | "ci_failed";

/**
 * Auto-recovery progress for an in-review PR. The machine increments
 * `attempts` on each `CONFLICT_DETECTED` / `CI_FAILED_DETECTED` and, once it
 * reaches `maxRecoveryAttempts`, routes to the terminal-ish `quarantined`
 * state instead of a fix state. This is the single source of truth that the
 * `.ralph/pr-tracker-state.json` file used to hold independently.
 */
export interface FlowRecovery {
  attempts: number;
  lastReason: FailureReason;
  /** ISO timestamp of the first detected failure — the AGE clock for failing /
   *  quarantined rows. Empty when no detection carried a timestamp. */
  firstFailedAt: string;
  /** PR URL the failing detection was scanned from. Lives on the snapshot so
   *  the board can link failing rows without re-plumbing per-poll maps. Empty
   *  when no detection carried a URL. */
  prUrl: string;
  /** ISO timestamp of the detection comment posted for the current recovery
   *  session (`RECOVERY_NOTIFIED kind:"detection"`). Survives restarts — the
   *  restart-proof replacement for the coordinator's `conflictNotified` /
   *  `ciFailedNotified` Sets. Cleared when a fix worker succeeds so the next
   *  genuine red re-notifies. */
  detectionNotifiedAt?: string;
  /** ISO timestamp of the promoted-to-fix-flow comment
   *  (`RECOVERY_NOTIFIED kind:"promotion"`). Same lifecycle as
   *  {@link detectionNotifiedAt}; replaces the `conflictPromoted` Set. */
  promotionNotifiedAt?: string;
  /** ISO timestamp of the quarantine give-up comment
   *  (`RECOVERY_NOTIFIED kind:"bail"`). Makes the bail comment once-only
   *  across restarts; only `QUARANTINE_CLEARED` resets it. */
  bailNotifiedAt?: string;
}

export type RecoveryNotificationKind = "detection" | "promotion" | "bail";

/**
 * Serializable lifecycle state. Survives a `getPersistedSnapshot` → JSON →
 * disk → rehydrate round-trip intact, so it is the part of the context that
 * may be trusted from a restored snapshot.
 */
export interface FlowData {
  issueId: string;
  graceMs: number;
  /** Quarantine threshold (`prRecovery.maxRecoverySessions`). `0` disables
   *  quarantine — recovery then loops indefinitely. */
  maxRecoveryAttempts: number;
  currentAssignment: FlowAssignment | undefined;
  pendingAssignment: FlowAssignment | undefined;
  recovery: FlowRecovery | undefined;
}

/**
 * Process-bound handles — NOT serializable (functions / live objects). XState
 * v5 restores context **from the snapshot** and does not re-run the `context`
 * factory on a snapshot restore, so these cannot be repopulated by re-passing
 * `input`. {@link FlowActorStore.getActor} re-injects a fresh `runtime` on
 * every disk rehydrate; it must never be trusted from a restored snapshot. A
 * live `worker` / `teardown` cannot outlive the process that spawned it, so
 * rehydration resets both to `undefined`.
 */
export interface FlowRuntime {
  bus: Bus;
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  worker: FlowWorker | undefined;
  teardown: Teardown | undefined;
}

export interface FlowContext {
  data: FlowData;
  runtime: FlowRuntime;
}

export type FlowInput = {
  issueId?: string;
  bus?: Bus;
  persist?: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  graceMs?: number;
  maxRecoveryAttempts?: number;
};

export interface PreemptActorInput {
  worker?: FlowWorker;
  graceMs: number;
  bus: Bus;
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  issueId: string;
  from?: FlowId;
  newAssignment: FlowAssignment;
  teardown?: Teardown;
}

export type WorkerSpawnedEvent = {
  type: "WORKER_SPAWNED";
  worker: FlowWorker;
  teardown?: Teardown;
  assignment: FlowAssignment;
};

export type PreemptEvent = { type: "PREEMPT"; newAssignment: FlowAssignment };

export type FlowEvent =
  | { type: "FRESH_PICKED_UP" }
  | { type: "RESUME_DETECTED" }
  | { type: "REVIEW_TRIGGERED" }
  | { type: "AWAITING_DETECTED" }
  /** A failing-PR detection. `at` (ISO) seeds `recovery.firstFailedAt` on the
   *  first failure — the AGE clock. `prUrl` records which PR was red. */
  | { type: "CONFLICT_DETECTED"; at?: string; prUrl?: string }
  | { type: "CI_FAILED_DETECTED"; at?: string; prUrl?: string }
  /** The coordinator posted a recovery-lifecycle comment — record the fact on
   *  the snapshot so the dedup survives restarts. */
  | { type: "RECOVERY_NOTIFIED"; kind: RecoveryNotificationKind; at: string }
  /** A human cleared the quarantine (e.g. removed the `ralph:error` label) to
   *  request a retry — reset the counter and re-engage recovery. */
  | { type: "QUARANTINE_CLEARED" }
  /** The PR became mergeable again — drop the recovery record so a stale
   *  failure does not linger on the board if the move-to-done is deferred. */
  | { type: "RECOVERY_CLEARED" }
  | { type: "CONFIRMATION_CLEARED" }
  | { type: "WORKER_SUCCEEDED" }
  | { type: "WORKER_FAILED" }
  /** Worker opened a PR; the ticket is not done yet — the watcher owns the
   *  move to done once the PR settles. Routes to `awaiting-ci`. */
  | { type: "PR_OPENED" }
  /** Watcher saw the PR become mergeable (CI green, no conflicts). Routes
   *  `awaiting-ci` → done. */
  | { type: "PR_PASSED" }
  | WorkerSpawnedEvent
  | PreemptEvent;

/** A failing-PR detection event (carries the optional AGE timestamp and PR URL). */
export type DetectionEvent = {
  type: "CONFLICT_DETECTED" | "CI_FAILED_DETECTED";
  at?: string;
  prUrl?: string;
};

export type RecoveryNotifiedEvent = {
  type: "RECOVERY_NOTIFIED";
  kind: RecoveryNotificationKind;
  at: string;
};
