import type { AgentOverrides, CliOverrides } from "@ralphy/cli-args";
import type { WorkflowConfig } from "@ralphy/workflow";

/** Where an effective config value came from. */
export type ConfigOrigin = "cli" | "workflow" | "default";

/** Map from each CLI override key to the WORKFLOW.md key it overrides. */
export const OVERRIDE_TO_WORKFLOW_KEY = {
  engine: "engine",
  model: "model",
  effort: "effort",
  maxIterations: "maxIterationsPerTask",
  maxCostUsd: "maxCostUsdPerTask",
  maxRuntimeMinutes: "maxRuntimeMinutesPerTask",
  maxConsecutiveFailures: "maxConsecutiveFailuresPerTask",
  delay: "iterationDelaySeconds",
  log: "logRawStream",
  verbose: "taskVerbose",
  manualTest: "enableManualTest",
} as const satisfies Record<keyof CliOverrides, keyof WorkflowConfig>;

export const OVERRIDE_KEYS: readonly (keyof CliOverrides)[] = [
  "engine",
  "model",
  "effort",
  "maxIterations",
  "maxCostUsd",
  "maxRuntimeMinutes",
  "maxConsecutiveFailures",
  "delay",
  "log",
  "verbose",
  "manualTest",
];

/**
 * The set of override keys whose provenance the merge core tracks — the union
 * of common CLI overrides and agent-only overrides.
 */
export type OriginKey = keyof CliOverrides | keyof AgentOverrides;
