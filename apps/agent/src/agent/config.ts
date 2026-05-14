import { ensureWorkflow, loadWorkflow, type WorkflowConfig } from "@ralphy/workflow";

/**
 * Re-export the workflow config under the legacy name so existing callers
 * (agent wire, list, json-runner, tests) keep working. `WORKFLOW.md` is the
 * one and only config file — there is no `ralphy.config.json` loader.
 */
export type RalphyConfig = WorkflowConfig;

export async function loadRalphyConfig(projectRoot: string): Promise<RalphyConfig> {
  const { config } = await loadWorkflow(projectRoot);
  return config;
}

export async function ensureRalphyConfig(projectRoot: string): Promise<string> {
  return ensureWorkflow(projectRoot);
}
