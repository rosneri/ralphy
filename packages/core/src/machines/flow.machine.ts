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

export interface FlowContext {
  issueId: string;
  bus: Bus;
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  graceMs: number;
  worker?: FlowWorker;
  teardown?: Teardown;
  currentAssignment?: FlowAssignment;
  pendingAssignment?: FlowAssignment;
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

  bus.emit({ type: "runtime.preempt.started", issueId, from: input.from ?? null, to: newAssignment.flowId });

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
  | WorkerSpawnedEvent
  | PreemptEvent;

const workerSpawnedAssign = assign(({ event }: { event: WorkerSpawnedEvent; context: FlowContext }) => ({
  worker: event.worker,
  teardown: event.teardown,
  currentAssignment: event.assignment,
}));

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
    issueId: input?.issueId ?? "",
    bus: input?.bus ?? createNoopBus(),
    persist: input?.persist ?? (() => {}),
    graceMs: input?.graceMs ?? 5000,
    worker: undefined,
    teardown: undefined,
    currentAssignment: undefined,
    pendingAssignment: undefined,
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
        WORKER_SUCCEEDED: "done",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({ pendingAssignment: ({ event }: { event: PreemptEvent; context: FlowContext }) => event.newAssignment }),
        },
        WORKER_SPAWNED: {
          actions: workerSpawnedAssign,
        },
      },
    },
    "conflict-fix": {
      on: {
        WORKER_SUCCEEDED: "working",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({ pendingAssignment: ({ event }: { event: PreemptEvent; context: FlowContext }) => event.newAssignment }),
        },
        WORKER_SPAWNED: {
          actions: workerSpawnedAssign,
        },
      },
    },
    "ci-fix": {
      on: {
        WORKER_SUCCEEDED: "working",
        WORKER_FAILED: "error",
        PREEMPT: {
          target: "preempting",
          actions: assign({ pendingAssignment: ({ event }: { event: PreemptEvent; context: FlowContext }) => event.newAssignment }),
        },
        WORKER_SPAWNED: {
          actions: workerSpawnedAssign,
        },
      },
    },
    awaiting: {
      on: {
        CONFIRMATION_CLEARED: "working",
        PREEMPT: {
          target: "preempting",
          actions: assign({ pendingAssignment: ({ event }: { event: PreemptEvent; context: FlowContext }) => event.newAssignment }),
        },
      },
    },
    review: {
      on: {
        WORKER_SUCCEEDED: "done",
        WORKER_FAILED: "error",
        WORKER_SPAWNED: {
          actions: workerSpawnedAssign,
        },
      },
    },
    preempting: {
      invoke: {
        src: "preemption",
        input: ({ context }: { context: FlowContext }) => ({
          worker: context.worker,
          graceMs: context.graceMs,
          bus: context.bus,
          persist: context.persist,
          issueId: context.issueId,
          from: context.currentAssignment?.flowId,
          newAssignment: context.pendingAssignment!,
          teardown: context.teardown,
        }),
        onDone: {
          actions: assign(({ context }: { context: FlowContext }) => ({
            worker: undefined,
            teardown: undefined,
            currentAssignment: context.pendingAssignment,
          })),
          target: "routing-after-preempt",
        },
        onError: "error",
      },
    },
    "routing-after-preempt": {
      always: [
        {
          guard: ({ context }: { context: FlowContext }) => context.pendingAssignment?.flowId === "conflict-fix",
          target: "conflict-fix",
        },
        {
          guard: ({ context }: { context: FlowContext }) => context.pendingAssignment?.flowId === "ci-fix",
          target: "ci-fix",
        },
        {
          guard: ({ context }: { context: FlowContext }) =>
            context.pendingAssignment?.flowId === "awaiting-ci" ||
            context.pendingAssignment?.flowId === "confirmation",
          target: "awaiting",
        },
        {
          guard: ({ context }: { context: FlowContext }) => context.pendingAssignment?.flowId === "review-followup",
          target: "review",
        },
        {
          guard: ({ context }: { context: FlowContext }) => context.pendingAssignment?.flowId === "idle",
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
