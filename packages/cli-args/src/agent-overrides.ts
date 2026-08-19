/**
 * The agent-only half of the sparse-override contract.
 *
 * These flags are parsed by the agent app, not by the common argv walk in
 * `common-args.ts`, and nothing here depends on that module — which is why
 * they live in their own file rather than beside `CliOverrides`.
 */
import type { WorkflowConfig } from "@ralphy/workflow";

/**
 * Sparse overrides for the agent-only config-backed flags — the loop has no
 * such flags, so they live in their own bag rather than polluting
 * `CliOverrides`. Same contract: presence is the only signal of user intent
 * (no sentinels), threaded through the same `mergeConfig` core with
 * `cli > workflow > default` precedence. `linearTeam` / `codeReview` both
 * target nested `linear.*` keys.
 */
export interface AgentOverrides {
  concurrency?: number;
  pollInterval?: number;
  linearTeam?: string;
  worktree?: boolean;
  createPr?: boolean;
  stackPrs?: boolean;
  codeReview?: boolean;
}

/**
 * Map from each agent override key to the WORKFLOW.md key it overrides. Both
 * `linearTeam` and `codeReview` map to `"linear"` — they set nested fields on
 * the same `linear` container (`linear.team`, `linear.codeReviewTrigger`), so
 * provenance is tracked at the `"linear"` top-level witness granularity.
 */
export const AGENT_OVERRIDE_TO_WORKFLOW_KEY = {
  concurrency: "concurrency",
  pollInterval: "pollIntervalSeconds",
  linearTeam: "linear",
  worktree: "useWorktree",
  createPr: "createPrOnSuccess",
  stackPrs: "stackPrsOnDependencies",
  codeReview: "linear",
} as const satisfies Record<keyof AgentOverrides, keyof WorkflowConfig>;

export const AGENT_OVERRIDE_KEYS: readonly (keyof AgentOverrides)[] = [
  "concurrency",
  "pollInterval",
  "linearTeam",
  "worktree",
  "createPr",
  "stackPrs",
  "codeReview",
];
