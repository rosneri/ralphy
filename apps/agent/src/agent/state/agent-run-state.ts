/**
 * Per-project agent-run state file. Written at agent startup so that
 * external tools (and humans poking at the filesystem after the fact) can
 * find the JSONL event log and config for a given project root without
 * having to grep `~/.ralph` or guess naming conventions.
 *
 * Location: `~/.ralph/<basename(projectRoot)>/agent-state.json` — sibling
 * to the project's `worktrees/` directory.
 */

import { basename, join } from "node:path";
import { homedir } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";

interface AgentRunState {
  /** Project root the agent is polling against. */
  projectRoot: string;
  /** Path to WORKFLOW.md (`ensureRalphyConfig` return value). */
  configPath: string;
  /** Linear team key (e.g. `RLF`, `LIT`). May be undefined when not set. */
  team: string | undefined;
  /** Absolute path to the `--json-log-file` JSONL stream. `null` when the
   *  agent was launched without `--json-log-file`. */
  jsonLogFile: string | null;
  /** ISO timestamp of the agent run starting. */
  startedAt: string;
  /** Ralphy version (from `apps/agent/src/cli.ts:VERSION`). */
  version: string;
}

/** Resolve the state-file path for a given project root. Stable across runs. */
export function agentRunStatePath(projectRoot: string): string {
  return join(homedir(), ".ralph", basename(projectRoot), "agent-state.json");
}

/** Write the agent-run state. Best-effort — swallows fs errors so a state
 *  write failure never tears down the live run. */
export async function writeAgentRunState(state: AgentRunState): Promise<void> {
  const path = agentRunStatePath(state.projectRoot);
  try {
    await mkdir(join(homedir(), ".ralph", basename(state.projectRoot)), { recursive: true });
    await writeFile(path, JSON.stringify(state, null, 2) + "\n", "utf-8");
  } catch {
    /* swallow — diagnostic metadata, not load-bearing */
  }
}
