/**
 * Re-export shim. The `AgentCoordinator` implementation lives in
 * `apps/agent/src/runtime/coordinator.ts`. This module exists so the
 * existing import sites (CLI, AgentMode.tsx, json-runner, tests) keep
 * compiling without churn while later stages move callers across.
 */
export {
  AgentCoordinator,
  type ActiveWorker,
  type CoordinatorDeps,
  type PauseState,
  type PollResult,
  type PrStatusBucket,
  type PrepareResult,
  type QueueTrigger,
  type MentionTrigger,
} from "../runtime/coordinator";
