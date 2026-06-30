import type { AgentOverrides, CliOverrides } from "@ralphy/cli-args";

/**
 * Re-encode sparse overrides as argv for a child worker. Exactly the keys the
 * user passed — the child re-runs `resolveConfig` against the same
 * WORKFLOW.md, so parent and child compute identical effective configs
 * through one code path (no pre-merged values in spawn commands).
 * Round-trip property: parsing the result yields the same overrides.
 */
export function serializeOverrides(overrides: Readonly<CliOverrides>): string[] {
  const argv: string[] = [];
  if (overrides.engine !== undefined) argv.push(`--${overrides.engine}`);
  if (overrides.model !== undefined) argv.push("--model", overrides.model);
  if (overrides.effort !== undefined) argv.push("--effort", overrides.effort);
  if (overrides.maxIterations !== undefined) {
    argv.push("--max-iterations", String(overrides.maxIterations));
  }
  if (overrides.maxCostUsd !== undefined) argv.push("--max-cost", String(overrides.maxCostUsd));
  if (overrides.maxRuntimeMinutes !== undefined) {
    argv.push("--max-runtime", String(overrides.maxRuntimeMinutes));
  }
  if (overrides.maxConsecutiveFailures !== undefined) {
    argv.push("--max-failures", String(overrides.maxConsecutiveFailures));
  }
  if (overrides.delay !== undefined) argv.push("--delay", String(overrides.delay));
  if (overrides.log) argv.push("--log");
  if (overrides.verbose) argv.push("--verbose");
  if (overrides.manualTest) argv.push("--manual-test");
  return argv;
}

/**
 * Re-encode sparse agent overrides as argv for a child worker — the agent-side
 * mirror of `serializeOverrides`. Exactly the keys the user passed, so a spawned
 * worker re-derives an identical effective config (E4). Round-trip property:
 * `parseAgentArgs(serializeAgentOverrides(x)).agentOverrides` equals `x`.
 */
export function serializeAgentOverrides(overrides: Readonly<AgentOverrides>): string[] {
  const argv: string[] = [];
  if (overrides.concurrency !== undefined)
    argv.push("--concurrency", String(overrides.concurrency));
  if (overrides.pollInterval !== undefined) {
    argv.push("--poll-interval", String(overrides.pollInterval));
  }
  if (overrides.linearTeam !== undefined) argv.push("--linear-team", overrides.linearTeam);
  if (overrides.worktree) argv.push("--worktree");
  if (overrides.createPr) argv.push("--create-pr");
  if (overrides.stackPrs) argv.push("--stack-prs");
  if (overrides.codeReview) argv.push("--code-review");
  return argv;
}
