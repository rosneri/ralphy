import { mergeConfig, type CliOverrides } from "@ralphy/config";
import { ensureWorkflow, loadWorkflow, type WorkflowConfig } from "@ralphy/workflow";

/**
 * Re-export the workflow config under the legacy name so existing callers
 * (agent wire, list, json-runner, tests) keep working. `WORKFLOW.md` is the
 * one and only config file — there is no `ralphy.config.json` loader.
 */
export type RalphyConfig = WorkflowConfig;

/**
 * Load WORKFLOW.md and merge the sparse CLI overrides through the one shared
 * merge function (`cli > workflow > default`). The returned config is the
 * EFFECTIVE config: downstream agent code reads `cfg.x` and never writes
 * `args.x || cfg.x` for any config-backed key again.
 */
export async function loadRalphyConfig(
  projectRoot: string,
  workflowFile?: string,
  overrides: CliOverrides = {},
): Promise<RalphyConfig> {
  const { config } = await loadWorkflow(projectRoot, workflowFile);
  return mergeConfig(config, overrides).effective;
}

export async function ensureRalphyConfig(
  projectRoot: string,
  workflowFile?: string,
): Promise<string> {
  return ensureWorkflow(projectRoot, workflowFile);
}
