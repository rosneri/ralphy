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

/**
 * Serializable lifecycle state. Survives a `getPersistedSnapshot` → JSON →
 * disk → rehydrate round-trip intact, so it is the part of the context that
 * may be trusted from a restored snapshot.
 */
export interface FlowData {
  issueId: string;
  graceMs: number;
  currentAssignment: FlowAssignment | undefined;
  pendingAssignment: FlowAssignment | undefined;
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
  | { type: "CONFLICT_DETECTED" }
  | { type: "CI_FAILED_DETECTED" }
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
      currentAssignment: undefined,
      pendingAssignment: undefined,
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
        CONFLICT_DETECTED: "conflict-fix",
        CI_FAILED_DETECTED: "ci-fix",
      },
    },
    working: {
      on: {
        AWAITING_DETECTED: "awaiting",
        CONFLICT_DETECTED: "conflict-fix",
        CI_FAILED_DETECTED: "ci-fix",
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
        CONFLICT_DETECTED: "conflict-fix",
        CI_FAILED_DETECTED: "ci-fix",
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
    done: {
      type: "final",
    },
    error: {
      type: "final",
    },
  },
});
