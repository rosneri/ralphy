import {
  resolveParsedConfig,
  type AgentOverrides,
  type CliOverrides,
} from "@ralphy/config";
import { emptyCommonArgs } from "@ralphy/cli-args";
import { ensureWorkflow, type WorkflowConfig } from "@ralphy/workflow";

/**
 * Re-export the workflow config under the legacy name so existing callers
 * (agent wire, list, json-runner, tests) keep working. `WORKFLOW.md` is the
 * one and only config file — there is no `ralphy.config.json` loader.
 */
export type RalphyConfig = WorkflowConfig;

/**
 * Resolve the EFFECTIVE config through the one shared pipeline
 * (`resolveParsedConfig` → `mergeConfig`, `cli > workflow > default`), folding
 * in both the common `CliOverrides` and the agent-only `AgentOverrides`.
 * Downstream agent code reads `cfg.x` and never re-implements an argv-or-config
 * fallback for any config-backed key again — the presence-based merge already
 * won that precedence here.
 */
export async function loadEffectiveConfig(
  projectRoot: string,
  workflowFile?: string,
  overrides: CliOverrides = {},
  agentOverrides: AgentOverrides = {},
): Promise<RalphyConfig> {
  const args = { ...emptyCommonArgs(), overrides, ...(workflowFile ? { workflowFile } : {}) };
  const resolved = await resolveParsedConfig({ args, agentOverrides, projectRoot });
  return resolved.effective;
}

export async function ensureRalphyConfig(
  projectRoot: string,
  workflowFile?: string,
): Promise<string> {
  return ensureWorkflow(projectRoot, workflowFile);
}
