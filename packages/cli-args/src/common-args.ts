import type { Engine } from "@ralphy/types";
import type { WorkflowConfig } from "@ralphy/workflow";

/**
 * Common CLI flags shared by the loop / agent / task entrypoints.
 *
 * The parse result is SPARSE: `overrides` contains exactly the keys the user
 * passed on argv — no baked defaults, no `engineSet`-style sentinels. Presence
 * is the only signal of user intent; `@ralphy/config` merges these overrides
 * onto the WORKFLOW.md config with explicit `cli > workflow > default`
 * precedence. Any API that re-introduces pre-filled defaults into a parse
 * result is a regression.
 *
 * The set of config-backed flags (which flag exists, its value kind, and the
 * WORKFLOW.md field it maps to) is declared once in
 * `@ralphy/workflow/cli-options` and consumed here. This module owns only the
 * typed assignment of each parsed value and the bespoke flags that have no
 * config field (`--claude`/`--codex`, `--unlimited`, `--name`, `--prompt`, …).
 */

/**
 * Only keys the user explicitly passed on argv. `--claude [model]` /
 * `--codex` set `engine` (and optionally `model`); `--unlimited` sets
 * `maxIterations: 0` — an explicit zero, distinct from "not passed".
 */
export interface CliOverrides {
  engine?: Engine;
  model?: string;
  effort?: string;
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  maxConsecutiveFailures?: number;
  delay?: number;
  log?: boolean;
  verbose?: boolean;
  manualTest?: boolean;
}

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

/** Bespoke flags with no WORKFLOW.md counterpart — pass-through, never merged. */
export interface CliPassthrough {
  projectRoot?: string | undefined;
  /** Absolute path to an alternate WORKFLOW.md (`--workflow`). Resolved against
   *  `--project-root` when that flag is given, otherwise against cwd. */
  workflowFile?: string | undefined;
  /** Change name / ticket identifier (`--name`). */
  name: string;
  /** Task description (`--prompt`, or the contents read from `--prompt-file`). */
  prompt: string;
  /** Set when spawned by the agent app (`--from-agent`). */
  fromAgent: boolean;
  /** Recovery flow this worker was spawned for (`--trigger`). Set by the
   *  agent's fix-worker spawns only; config resolution uses it to pick the
   *  per-flow model/effort (`prRecovery.ciFix*` / `prRecovery.conflictFix*`). */
  trigger?: "ci-fix" | "conflict-fix";
}

export interface CommonArgs extends CliPassthrough {
  /** Sparse config overrides — exactly what argv set. */
  overrides: CliOverrides;
}

export function emptyCommonArgs(): CommonArgs {
  return {
    overrides: {},
    projectRoot: undefined,
    workflowFile: undefined,
    name: "",
    prompt: "",
    fromAgent: false,
  };
}
