import { assign, fromPromise, setup } from "xstate";
import { createNoopBus, type Bus } from "@ralphy/events";

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
}

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

/**
 * Preemption protocol (8 steps):
 *   1. emit runtime.preempt.started
 *   2. SIGTERM (skipped when worker is undefined)
 *   3. wait up to graceMs for exit (skipped when worker is undefined)
 *   4. SIGKILL if still alive (skipped when worker is undefined)
 *   5. await exit (skipped when worker is undefined)
 *   6. teardown("cancelled") — errors swallowed
 *   7. persist new assignment
 *   8. emit runtime.preempt.completed
 */
export const preemptionActorLogic = fromPromise<void, PreemptActorInput>(async ({ input }) => {
  const { worker, graceMs, teardown, persist, issueId, newAssignment, bus } = input;

  bus.emit({
    type: "runtime.preempt.started",
    issueId,
    from: input.from ?? null,
    to: newAssignment.flowId,
  });

  if (worker !== undefined) {
    try {
      worker.kill("SIGTERM");
    } catch {
      /* worker may already be dead */
    }

    const exited = await Promise.race([
      worker.exited.then(() => "exited" as const),
      new Promise<"timeout">((resolve) => {
        const t = setTimeout(() => resolve("timeout"), graceMs);
        t.unref();
      }),
    ]);

    if (exited === "timeout") {
      try {
        worker.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      await worker.exited;
    }
  }

  if (teardown) {
    try {
      await teardown("cancelled");
    } catch {
      /* swallowed — teardown errors must not block preemption */
    }
  }

  await persist(issueId, newAssignment);

  bus.emit({ type: "runtime.preempt.completed", issueId, to: newAssignment.flowId });
});

type WorkerSpawnedEvent = {
  type: "WORKER_SPAWNED";
  worker: FlowWorker;
  teardown?: Teardown;
  assignment: FlowAssignment;
};

type PreemptEvent = { type: "PREEMPT"; newAssignment: FlowAssignment };

type FlowEvent =
  | { type: "FRESH_PICKED_UP" }
  | { type: "RESUME_DETECTED" }
  | { type: "REVIEW_TRIGGERED" }
  | { type: "AWAITING_DETECTED" }
  /** A failing-PR detection. `at` (ISO) seeds `recovery.firstFailedAt` on the
   *  first failure — the AGE clock. */
  | { type: "CONFLICT_DETECTED"; at?: string }
  | { type: "CI_FAILED_DETECTED"; at?: string }
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

/** A failing-PR detection event (carries the optional AGE timestamp). */
type DetectionEvent = { type: "CONFLICT_DETECTED" | "CI_FAILED_DETECTED"; at?: string };

/**
 * `assign` updater for a fresh failure detection: bump `attempts`, set
 * `lastReason`, and seed `firstFailedAt` once (first detection wins).
 */
function recordDetection(reason: FailureReason) {
  return ({
    context,
    event,
  }: {
    context: FlowContext;
    event: DetectionEvent;
  }): { data: FlowData } => {
    const previous = context.data.recovery;
    return {
      data: {
        ...context.data,
        recovery: {
          attempts: (previous?.attempts ?? 0) + 1,
          lastReason: reason,
          firstFailedAt: previous?.firstFailedAt ?? event.at ?? "",
        },
      },
    };
  };
}

/** Guard: this detection tips the ticket over the quarantine threshold. A
 *  threshold of `0` (unconfigured) disables quarantine entirely. */
function reachesQuarantine({ context }: { context: FlowContext }): boolean {
  const max = context.data.maxRecoveryAttempts;
  return max > 0 && (context.data.recovery?.attempts ?? 0) + 1 >= max;
}

/** `assign` updater for a re-detection while already quarantined: refresh the
 *  reason without re-counting (mirrors the old tracker's post-bail behavior). */
function refreshReason(reason: FailureReason) {
  return ({ context }: { context: FlowContext }): { data: FlowData } => ({
    data: {
      ...context.data,
      recovery: context.data.recovery
        ? { ...context.data.recovery, lastReason: reason }
        : { attempts: 0, lastReason: reason, firstFailedAt: "" },
    },
  });
}

/** `assign` updater that drops the recovery record — the PR is healthy again
 *  (mergeable) or the human cleared the quarantine. Mirrors the old
 *  `PrTracker.clear`. */
function clearRecovery({ context }: { context: FlowContext }): { data: FlowData } {
  return { data: { ...context.data, recovery: undefined } };
}

export const flowMachine = setup({
  types: {} as {
    context: FlowContext;
    events: FlowEvent;
    input: FlowInput;
  },
  actors: {
    preemption: preemptionActorLogic,
  },
}).createMachine({
  id: "flow",
  context: ({ input }) => ({
    data: {
      issueId: input?.issueId ?? "",
      graceMs: input?.graceMs ?? 5000,
      maxRecoveryAttempts: input?.maxRecoveryAttempts ?? 0,
      currentAssignment: undefined,
      pendingAssignment: undefined,
      recovery: undefined,
    },
    runtime: {
      bus: input?.bus ?? createNoopBus(),
      persist: input?.persist ?? (() => {}),
      worker: undefined,
      teardown: undefined,
    },
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        FRESH_PICKED_UP: "working",
        RESUME_DETECTED: "working",
        REVIEW_TRIGGERED: "review",
        CONFLICT_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("conflicting")),
          },
          { target: "conflict-fix", actions: assign(recordDetection("conflicting")) },
        ],
        CI_FAILED_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("ci_failed")),
          },
          { target: "ci-fix", actions: assign(recordDetection("ci_failed")) },
        ],
      },
    },
    working: {
      on: {
        AWAITING_DETECTED: "awaiting",
        CONFLICT_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("conflicting")),
          },
          { target: "conflict-fix", actions: assign(recordDetection("conflicting")) },
        ],
        CI_FAILED_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("ci_failed")),
          },
          { target: "ci-fix", actions: assign(recordDetection("ci_failed")) },
        ],
        PR_OPENED: "awaiting-ci",
        WORKER_SUCCEEDED: "done",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({
            data: ({ context, event }: { context: FlowContext; event: PreemptEvent }) => ({
              ...context.data,
              pendingAssignment: event.newAssignment,
            }),
          }),
        },
        WORKER_SPAWNED: {
          actions: assign(
            ({ context, event }: { context: FlowContext; event: WorkerSpawnedEvent }) => ({
              data: { ...context.data, currentAssignment: event.assignment },
              runtime: {
                ...context.runtime,
                worker: event.worker,
                teardown: event.teardown ?? undefined,
              },
            }),
          ),
        },
      },
    },
    "conflict-fix": {
      on: {
        // A recovered PR isn't done — it goes back to waiting for the watcher
        // to confirm it's mergeable (or red again) on the next scan.
        WORKER_SUCCEEDED: "awaiting-ci",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({
            data: ({ context, event }: { context: FlowContext; event: PreemptEvent }) => ({
              ...context.data,
              pendingAssignment: event.newAssignment,
            }),
          }),
        },
        WORKER_SPAWNED: {
          actions: assign(
            ({ context, event }: { context: FlowContext; event: WorkerSpawnedEvent }) => ({
              data: { ...context.data, currentAssignment: event.assignment },
              runtime: {
                ...context.runtime,
                worker: event.worker,
                teardown: event.teardown ?? undefined,
              },
            }),
          ),
        },
      },
    },
    "ci-fix": {
      on: {
        // A recovered PR isn't done — it goes back to waiting for the watcher
        // to confirm it's mergeable (or red again) on the next scan.
        WORKER_SUCCEEDED: "awaiting-ci",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({
            data: ({ context, event }: { context: FlowContext; event: PreemptEvent }) => ({
              ...context.data,
              pendingAssignment: event.newAssignment,
            }),
          }),
        },
        WORKER_SPAWNED: {
          actions: assign(
            ({ context, event }: { context: FlowContext; event: WorkerSpawnedEvent }) => ({
              data: { ...context.data, currentAssignment: event.assignment },
              runtime: {
                ...context.runtime,
                worker: event.worker,
                teardown: event.teardown ?? undefined,
              },
            }),
          ),
        },
      },
    },
    awaiting: {
      on: {
        CONFIRMATION_CLEARED: "working",
        PREEMPT: {
          target: "preempting",
          actions: assign({
            data: ({ context, event }: { context: FlowContext; event: PreemptEvent }) => ({
              ...context.data,
              pendingAssignment: event.newAssignment,
            }),
          }),
        },
      },
    },
    // PR is open and the worker has finished; the ticket rests here until the
    // watcher advances it (PR_PASSED → done) or re-engages recovery on a red PR.
    "awaiting-ci": {
      on: {
        PR_PASSED: "done",
        RECOVERY_CLEARED: { actions: assign(clearRecovery) },
        CONFLICT_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("conflicting")),
          },
          { target: "conflict-fix", actions: assign(recordDetection("conflicting")) },
        ],
        CI_FAILED_DETECTED: [
          {
            guard: reachesQuarantine,
            target: "quarantined",
            actions: assign(recordDetection("ci_failed")),
          },
          { target: "ci-fix", actions: assign(recordDetection("ci_failed")) },
        ],
        // A @ralphy mention on a deferred (PR-open) ticket routes into review;
        // the review worker pushes to the open PR and the actor returns to
        // awaiting-ci (PR_OPENED) to re-await mergeable, rather than stranding.
        REVIEW_TRIGGERED: "review",
        PREEMPT: {
          target: "preempting",
          actions: assign({
            data: ({ context, event }: { context: FlowContext; event: PreemptEvent }) => ({
              ...context.data,
              pendingAssignment: event.newAssignment,
            }),
          }),
        },
        WORKER_SPAWNED: {
          actions: assign(
            ({ context, event }: { context: FlowContext; event: WorkerSpawnedEvent }) => ({
              data: { ...context.data, currentAssignment: event.assignment },
              runtime: {
                ...context.runtime,
                worker: event.worker,
                teardown: event.teardown ?? undefined,
              },
            }),
          ),
        },
      },
    },
    review: {
      on: {
        WORKER_SUCCEEDED: "done",
        // Review on a PR-producing run defers to the watcher: the worker pushed
        // to the open PR, so re-await mergeability instead of jumping to done.
        // (The coordinator sends PR_OPENED instead of WORKER_SUCCEEDED when the
        // run opens PRs and recovery is enabled.)
        PR_OPENED: "awaiting-ci",
        WORKER_FAILED: "error",
        WORKER_SPAWNED: {
          actions: assign(
            ({ context, event }: { context: FlowContext; event: WorkerSpawnedEvent }) => ({
              data: { ...context.data, currentAssignment: event.assignment },
              runtime: {
                ...context.runtime,
                worker: event.worker,
                teardown: event.teardown ?? undefined,
              },
            }),
          ),
        },
      },
    },
    preempting: {
      invoke: {
        src: "preemption",
        input: ({ context }: { context: FlowContext }) => ({
          graceMs: context.data.graceMs,
          bus: context.runtime.bus,
          persist: context.runtime.persist,
          issueId: context.data.issueId,
          newAssignment: context.data.pendingAssignment!,
          ...(context.data.currentAssignment !== undefined
            ? { from: context.data.currentAssignment.flowId }
            : {}),
          ...(context.runtime.worker !== undefined ? { worker: context.runtime.worker } : {}),
          ...(context.runtime.teardown !== undefined ? { teardown: context.runtime.teardown } : {}),
        }),
        onDone: {
          actions: assign(({ context }: { context: FlowContext }) => ({
            data: { ...context.data, currentAssignment: context.data.pendingAssignment },
            runtime: { ...context.runtime, worker: undefined, teardown: undefined },
          })),
          target: "routing-after-preempt",
        },
        onError: "error",
      },
    },
    "routing-after-preempt": {
      always: [
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "conflict-fix",
          target: "conflict-fix",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "ci-fix",
          target: "ci-fix",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "awaiting-ci",
          target: "awaiting-ci",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "confirmation",
          target: "awaiting",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "review-followup",
          target: "review",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.data.pendingAssignment?.flowId === "idle",
          target: "idle",
        },
        { target: "working" },
      ],
    },
    // Auto-recovery exhausted (`attempts` reached `maxRecoveryAttempts`). A
    // human owns the PR now. Not final — a human can clear the quarantine
    // (e.g. remove the `ralph:error` label) to request a fresh retry. A
    // re-detection while here only refreshes the reason; it does not re-count
    // or re-route (mirrors the old tracker's post-bail behavior).
    quarantined: {
      on: {
        // A human resolved the PR and it is mergeable again — advance to done
        // (the coordinator drives this the same as an awaiting-ci PR_PASSED).
        PR_PASSED: "done",
        QUARANTINE_CLEARED: { target: "idle", actions: assign(clearRecovery) },
        CONFLICT_DETECTED: { actions: assign(refreshReason("conflicting")) },
        CI_FAILED_DETECTED: { actions: assign(refreshReason("ci_failed")) },
      },
    },
    done: {
      type: "final",
    },
    error: {
      type: "final",
    },
  },
});
