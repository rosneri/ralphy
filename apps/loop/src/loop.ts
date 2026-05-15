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
export {
  allCompleted as allTasksCompleted,
  countUnchecked as countUncheckedTasks,
  bothFilesCompleted,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
} from "@ralphy/core/tasks-md";
