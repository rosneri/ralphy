import { assign, setup } from "xstate";
import type { StopReason } from "../loop";

export interface LoopMachineOptions {
  maxIterations: number;
  maxCostUsd: number;
  maxRuntimeMinutes: number;
  maxConsecutiveFailures: number;
}

export interface LoopMachineContext {
  iteration: number;
  costUsd: number;
  consecutiveFailures: number;
  startTime: number;
  options: LoopMachineOptions;
  status: "active" | "blocked" | "completed";
  uncommittedEdits: boolean;
}

export type LoopMachineEvent =
  | {
      type: "START";
      options: LoopMachineOptions;
      startTime: number;
      startingIteration?: number;
      startingCostUsd?: number;
      startingStatus?: LoopMachineContext["status"];
    }
  | { type: "ITERATION_DONE"; costDeltaUsd: number }
  /** Failure-counting semantics (single source of truth): ANY consecutive
   *  failed iteration increments the counter; a success resets it. The
   *  failures do not need to be identical. */
  | { type: "ITERATION_FAILED" }
  | { type: "RATE_LIMITED" }
  /** The loop polls `.ralph-state.json` between iterations; when an external
   *  writer flips `status` away from "active", the runner reports it here so
   *  the `statusNotActive` guard — not an imperative check — stops the loop. */
  | { type: "STATUS_CHANGED"; status: LoopMachineContext["status"] }
  | { type: "ALL_TASKS_DONE"; uncommittedEdits: boolean };

export function stoppedStateToReason(snapshot: { value: unknown }): StopReason | null {
  const val = snapshot.value;
  if (typeof val === "object" && val !== null && "stopped" in val) {
    return (val as Record<string, string>).stopped as StopReason;
  }
  return null;
}

export const loopMachine = setup({
  types: {} as {
    context: LoopMachineContext;
    events: LoopMachineEvent;
  },
  guards: {
    maxIterationsReached: ({ context }) =>
      context.options.maxIterations > 0 && context.iteration >= context.options.maxIterations,
    statusNotActive: ({ context }) => context.status !== "active",
    costCapReached: ({ context }) =>
      context.options.maxCostUsd > 0 && context.costUsd >= context.options.maxCostUsd,
    runtimeLimitReached: ({ context }) =>
      context.options.maxRuntimeMinutes > 0 &&
      Date.now() - context.startTime >= context.options.maxRuntimeMinutes * 60_000,
    consecutiveFailuresReached: ({ context }) =>
      context.options.maxConsecutiveFailures > 0 &&
      context.consecutiveFailures >= context.options.maxConsecutiveFailures,
    hasUncommittedEdits: ({ event }) => event.type === "ALL_TASKS_DONE" && event.uncommittedEdits,
  },
}).createMachine({
  id: "loop",
  initial: "idle",
  context: {
    iteration: 0,
    costUsd: 0,
    consecutiveFailures: 0,
    startTime: 0,
    options: {
      maxIterations: 0,
      maxCostUsd: 0,
      maxRuntimeMinutes: 0,
      maxConsecutiveFailures: 0,
    },
    status: "active",
    uncommittedEdits: false,
  },
  states: {
    idle: {
      on: {
        START: {
          target: "checkingStop",
          actions: assign({
            options: ({ event }) => event.options,
            startTime: ({ event }) => event.startTime,
            iteration: ({ event }) => event.startingIteration ?? 0,
            costUsd: ({ event }) => event.startingCostUsd ?? 0,
            status: ({ event }) => event.startingStatus ?? "active",
          }),
        },
      },
    },
    checkingStop: {
      always: [
        { guard: "maxIterationsReached", target: "stopped.maxIterations" },
        { guard: "statusNotActive", target: "stopped.completed" },
        { guard: "costCapReached", target: "stopped.costCap" },
        { guard: "runtimeLimitReached", target: "stopped.runtimeLimit" },
        { guard: "consecutiveFailuresReached", target: "stopped.consecutiveFailures" },
        { target: "running" },
      ],
    },
    running: {
      on: {
        ITERATION_DONE: {
          target: "checkingStop",
          actions: assign({
            iteration: ({ context }) => context.iteration + 1,
            costUsd: ({ context, event }) => context.costUsd + event.costDeltaUsd,
            consecutiveFailures: () => 0,
          }),
        },
        ITERATION_FAILED: {
          target: "checkingStop",
          actions: assign({
            consecutiveFailures: ({ context }) => context.consecutiveFailures + 1,
          }),
        },
        RATE_LIMITED: {
          target: "stopped.rateLimited",
        },
        STATUS_CHANGED: {
          target: "checkingStop",
          actions: assign({
            status: ({ event }) => event.status,
          }),
        },
        ALL_TASKS_DONE: [
          {
            guard: "hasUncommittedEdits",
            target: "stopped.stranded",
          },
          {
            target: "stopped.completed",
          },
        ],
      },
    },
    stopped: {
      initial: "maxIterations",
      states: {
        maxIterations: { type: "final" },
        completed: { type: "final" },
        costCap: { type: "final" },
        runtimeLimit: { type: "final" },
        consecutiveFailures: { type: "final" },
        rateLimited: { type: "final" },
        stranded: { type: "final" },
      },
    },
  },
});
