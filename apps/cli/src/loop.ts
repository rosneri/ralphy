// Re-export shared loop utilities from @ralphy/core
export {
  type LoopOptions,
  type StopReason,
  buildTaskPrompt,
  checkStopCondition,
  checkStopSignal,
  updateStateIteration,
  appendSteeringMessage,
  buildSteeringPrompt,
  mergeUsage,
} from "@ralphy/core/loop";
export { allCompleted, countUnchecked } from "@ralphy/core/tasks-md";
