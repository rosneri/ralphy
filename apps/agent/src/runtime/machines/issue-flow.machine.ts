import { assign, setup } from "xstate";
import type { FlowAssignment, RouterSignals } from "../types";

export interface IssueFlowContext {
  issueId: string;
  signals: RouterSignals | null;
  assignment: FlowAssignment | null;
  workerExitCode: number | null;
}

type IssueFlowInput = { issueId: string };

export type IssueFlowEvent =
  | { type: "ROUTE"; signals: RouterSignals }
  | { type: "WORKER_STARTED" }
  | { type: "WORKER_EXITED"; exitCode: number }
  | { type: "AWAITING_CI_SETTLED"; ok: boolean }
  | { type: "PREEMPTED"; signals: RouterSignals }
  | { type: "RESET" };

// Coordinator treats exit code 2 (NO_CHANGES_EXIT = 72 in post-task.ts) as success.
// Re-derived here to avoid a circular import from the top-level agent package.
const NO_CHANGES_EXIT = 72;

function makeAssignment(
  flowId: FlowAssignment["flowId"],
  reason: string,
  signals: RouterSignals | null,
): FlowAssignment {
  return { flowId, reason, boost: signals?.boost ?? "p3" };
}

export const issueFlowMachine = setup({
  types: {
    context: {} as IssueFlowContext,
    events: {} as IssueFlowEvent,
    input: {} as IssueFlowInput,
  },
  guards: {
    isRevise: ({ context }) =>
      context.signals?.awaiting === "revise" || context.signals?.mention === "revise",
    isConfirm: ({ context }) => context.signals?.awaiting === "awaiting",
    isConflicting: ({ context }) =>
      context.signals?.prStatus === "conflicting" || context.signals?.bucket === "conflicted",
    isCiFailing: ({ context }) => context.signals?.prStatus === "ci-failing",
    isAwaitingCiPass: ({ context }) =>
      context.signals?.awaitingCi === "watching" && context.signals?.prStatus === "mergeable",
    isAwaitingCiWatch: ({ context }) => context.signals?.awaitingCi === "watching",
    isReviewBucket: ({ context }) => context.signals?.bucket === "review",
    isStuck: ({ context }) => context.signals?.stuck === true,
    isNewTicket: ({ context }) =>
      context.signals?.bucket === "todo" && context.signals?.mention === "new-ticket",
    isMentionCatchAll: ({ context }) =>
      context.signals != null && context.signals.mention !== "none",
    isInProgressImplement: ({ context }) => context.signals?.bucket === "in-progress",
    isTodoImplement: ({ context }) => context.signals?.bucket === "todo",
    workerExitedOk: ({ event }) =>
      event.type === "WORKER_EXITED" &&
      (event.exitCode === 0 || event.exitCode === NO_CHANGES_EXIT),
    requiresWorker: ({ context }) => context.assignment?.flowId !== "awaiting-ci",
    awaitingCiSettledOk: ({ event }) => event.type === "AWAITING_CI_SETTLED" && event.ok,
  },
}).createMachine({
  id: "issueFlow",
  context: ({ input }) => ({
    issueId: input.issueId,
    signals: null,
    assignment: null,
    workerExitCode: null,
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    detecting: {
      always: [
        {
          guard: "isRevise",
          target: "confirmation",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("confirmation", "awaiting → revise", context.signals),
          }),
        },
        {
          guard: "isConfirm",
          target: "confirmation",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("confirmation", "awaiting → confirm", context.signals),
          }),
        },
        {
          guard: "isConflicting",
          target: "conflictFix",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("conflict-fix", "pr conflicting", context.signals),
          }),
        },
        {
          guard: "isCiFailing",
          target: "ciFix",
          actions: assign({
            assignment: ({ context }) => makeAssignment("ci-fix", "pr ci failing", context.signals),
          }),
        },
        {
          guard: "isAwaitingCiPass",
          target: "awaitingCi",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("awaiting-ci", "awaiting-ci pass", context.signals),
          }),
        },
        {
          guard: "isAwaitingCiWatch",
          target: "awaitingCi",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("awaiting-ci", "awaiting-ci watch", context.signals),
          }),
        },
        {
          guard: "isReviewBucket",
          target: "reviewFollowup",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("review-followup", "review bucket", context.signals),
          }),
        },
        {
          guard: "isStuck",
          target: "stuck",
          actions: assign({
            assignment: ({ context }) => makeAssignment("stuck", "stuck", context.signals),
          }),
        },
        {
          guard: "isNewTicket",
          target: "newTicket",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("new-ticket", "new ticket", context.signals),
          }),
        },
        {
          guard: "isMentionCatchAll",
          target: "mention",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("mention", "mention catch-all", context.signals),
          }),
        },
        {
          guard: "isInProgressImplement",
          target: "implement",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("implement", "in-progress implement", context.signals),
          }),
        },
        {
          guard: "isTodoImplement",
          target: "implement",
          actions: assign({
            assignment: ({ context }) =>
              makeAssignment("implement", "todo implement", context.signals),
          }),
        },
        {
          target: "idle",
          actions: assign({ assignment: null }),
        },
      ],
    },
    confirmation: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    conflictFix: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    ciFix: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    awaitingCi: {
      on: {
        AWAITING_CI_SETTLED: [
          { guard: "awaitingCiSettledOk", target: "done" },
          { target: "detecting" },
        ],
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    implement: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    reviewFollowup: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    newTicket: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    mention: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    stuck: {
      on: {
        WORKER_STARTED: { target: "workerRunning" },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    workerRunning: {
      on: {
        WORKER_EXITED: [
          {
            guard: "workerExitedOk",
            target: "done",
            actions: assign({ workerExitCode: ({ event }) => event.exitCode }),
          },
          {
            target: "error",
            actions: assign({ workerExitCode: ({ event }) => event.exitCode }),
          },
        ],
        PREEMPTED: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
        ROUTE: {
          target: "detecting",
          actions: assign({ signals: ({ event }) => event.signals }),
        },
      },
    },
    done: {
      on: {
        RESET: { target: "idle" },
      },
    },
    error: {
      on: {
        RESET: { target: "idle" },
      },
    },
  },
});
