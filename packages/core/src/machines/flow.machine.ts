import { assign, setup } from "xstate";
import { createNoopBus } from "@ralphy/events";
import {
  clearRecovery,
  clearSessionNotifications,
  preemptionActorLogic,
  reachesQuarantine,
  recordDetection,
  recordNotification,
  refreshReason,
} from "./flow-machine-actions";
import type {
  FlowContext,
  FlowEvent,
  FlowInput,
  PreemptEvent,
  WorkerSpawnedEvent,
} from "./flow-machine-types";

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
        // The PR became mergeable while parked here — drop the stale record
        // so the board stops showing a now-green PR as failing.
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
      },
    },
    working: {
      on: {
        AWAITING_DETECTED: "awaiting",
        // See `idle` — a now-green PR must not keep a stale failure record.
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
        // to confirm it's mergeable (or red again) on the next scan. The
        // session's notification stamps clear so the next genuine red
        // re-notifies (mirrors the old Set-clearing on fix-worker success).
        WORKER_SUCCEEDED: { target: "awaiting-ci", actions: assign(clearSessionNotifications) },
        RECOVERY_NOTIFIED: { actions: assign(recordNotification) },
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
        // to confirm it's mergeable (or red again) on the next scan. The
        // session's notification stamps clear so the next genuine red
        // re-notifies (mirrors the old Set-clearing on fix-worker success).
        WORKER_SUCCEEDED: { target: "awaiting-ci", actions: assign(clearSessionNotifications) },
        RECOVERY_NOTIFIED: { actions: assign(recordNotification) },
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
        // See `idle` — a now-green PR must not keep a stale failure record.
        RECOVERY_CLEARED: { actions: assign(clearRecovery) },
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
        RECOVERY_NOTIFIED: { actions: assign(recordNotification) },
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
