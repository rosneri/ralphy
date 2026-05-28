import type { State } from "@ralphy/types";
import type { TaskPhase } from "./loop";

export interface MetaPromptOptions {
  /** Set to false to opt out of the meta-prompt entirely. Defaults to true. */
  enabled?: boolean;
  maxIterations?: number;
  maxCostUsd?: number;
  maxRuntimeMinutes?: number;
  useWorktree?: boolean;
  worktreePath?: string;
  createPr?: boolean;
  confirmationMode?: boolean;
  linearIssueIdentifier?: string;
  linearIssueUrl?: string;
}

const PHASE_GUIDANCE: Record<TaskPhase, string> = {
  research: [
    "You are in the **research** phase. Your goal is to understand, not to implement.",
    "- Read files, trace call sites, identify patterns and conventions",
    "- Do NOT make any code changes in this phase",
    "- Write your findings to a research summary when done",
  ].join("\n"),
  plan: [
    "You are in the **plan** phase. Produce proposal/design/tasks artifacts.",
    "- Fill in `proposal.md` (`## Why`, `## What Changes`, `## Acceptance Criteria`)",
    "- Fill in `design.md` with technical design, files to touch, data flow, and edge cases",
    "- Create or update `tasks.md` with a concrete implementation checklist",
    "- Validate with `bunx openspec validate <change-name>` before finishing",
    "- Do NOT write implementation code yet",
  ].join("\n"),
  execute: [
    "You are in the **execute** phase. Implement the planned changes.",
    "- Work through the tasks.md checklist one item at a time",
    "- Run `bun run lint` and `bun run test` before finishing",
    "- Commit as you go; never use `git add -A` or `git commit -am`",
    "- Check off each task (`- [x]`) as you complete it",
  ].join("\n"),
  review: [
    "You are in the **review** phase. Audit the implementation against the spec.",
    "- Compare the diff against acceptance criteria in `proposal.md`",
    "- Document open findings as `- [ ] <finding>` under `## Open` in `review-findings.md`",
    "- Write `(no findings — close round)` if the implementation is clean",
    "- Do NOT implement any fixes in this phase — only audit and document",
  ].join("\n"),
};

/**
 * Build the task-level meta-prompt fragment that is prepended to each iteration prompt.
 * Returns an empty string when opts.enabled is false.
 *
 * The output has three sections:
 *   1. Always-on preamble  — change name, engine/model, phase, iteration/cost budgets
 *   2. Phase guidance      — behavior guidance specific to the active task phase
 *   3. Dynamic flags       — notable runtime flags currently in effect
 */
export function buildMetaPrompt(
  state: State,
  phase: TaskPhase,
  options: MetaPromptOptions = {},
): string {
  if (options.enabled === false) return "";

  let out = "---\n\n## Task Context\n\n";

  // Section 1: Always-on preamble
  out += `**Change:** \`${state.name}\`\n`;
  out += `**Engine/Model:** ${state.engine} / ${state.model}\n`;
  out += `**Phase:** ${phase}\n`;
  out += `**Iteration:** ${state.iteration + 1}`;
  if (options.maxIterations && options.maxIterations > 0) {
    out += ` of ${options.maxIterations}`;
  }
  out += "\n";
  if (options.maxCostUsd && options.maxCostUsd > 0) {
    const costSoFar = state.usage.total_cost_usd.toFixed(4);
    out += `**Cost so far:** $${costSoFar} of $${options.maxCostUsd}\n`;
  }
  if (options.maxRuntimeMinutes && options.maxRuntimeMinutes > 0) {
    out += `**Runtime budget:** ${options.maxRuntimeMinutes} min\n`;
  }
  out += "\n";

  // Section 2: Phase-specific guidance
  out += `### Phase Guidance\n\n`;
  out += PHASE_GUIDANCE[phase] + "\n\n";

  // Section 3: Dynamic flags (only emit notable non-default flags)
  const flags: string[] = [];
  if (options.useWorktree) {
    const path = options.worktreePath ? ` (\`${options.worktreePath}\`)` : "";
    flags.push(`Worktree mode: active${path}`);
  }
  if (options.createPr) {
    flags.push("PR on success: yes");
  }
  if (options.confirmationMode) {
    flags.push("Confirmation mode: active");
  }
  if (options.linearIssueIdentifier) {
    const url = options.linearIssueUrl ? ` — ${options.linearIssueUrl}` : "";
    flags.push(`Linear issue: ${options.linearIssueIdentifier}${url}`);
  }

  if (flags.length > 0) {
    out += `### Active Flags\n\n`;
    out += flags.map((f) => `- ${f}`).join("\n") + "\n\n";
  }

  out += "---\n\n";
  return out;
}
