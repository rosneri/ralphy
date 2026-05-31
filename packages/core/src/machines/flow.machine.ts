import { setup } from "xstate";

type FlowEvent =
  | { type: "FRESH_PICKED_UP" }
  | { type: "RESUME_DETECTED" }
  | { type: "REVIEW_TRIGGERED" }
  | { type: "AWAITING_DETECTED" }
  | { type: "CONFLICT_DETECTED" }
  | { type: "CI_FAILED_DETECTED" }
  | { type: "CONFIRMATION_CLEARED" }
  | { type: "WORKER_SUCCEEDED" }
  | { type: "WORKER_FAILED" };

export const flowMachine = setup({
  types: {} as {
    events: FlowEvent;
  },
}).createMachine({
  id: "flow",
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
      },
    },
    "conflict-fix": {
      on: {
        WORKER_SUCCEEDED: "working",
        WORKER_FAILED: "error",
      },
    },
    "ci-fix": {
      on: {
        WORKER_SUCCEEDED: "working",
        WORKER_FAILED: "error",
      },
    },
    awaiting: {
      on: {
        CONFIRMATION_CLEARED: "working",
      },
    },
    review: {
      on: {
        WORKER_SUCCEEDED: "done",
        WORKER_FAILED: "error",
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
