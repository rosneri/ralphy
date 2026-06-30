import type { State } from "@ralphy/types";
import type { OpenSpecPhase } from "../openspec/phase";
import type { TaskPhase } from "../prompt/meta-prompt";
import type { LoopPreambleContext, ReviewPhaseConfig } from "../loop";
import { buildPhasePrompt } from "./task-prompts";

/**
 * Build the always-on loop context preamble block.
 */
export function buildLoopPreamble(ctx: LoopPreambleContext): string {
  const iterStr =
    ctx.maxIterations === 0
      ? `${ctx.currentIteration} of unlimited`
      : `${ctx.currentIteration} of ${ctx.maxIterations}`;
  const costCapStr = ctx.maxCostUsd === 0 ? "no cap" : `$${ctx.maxCostUsd.toFixed(2)}`;
  const runtimeCapStr = ctx.maxRuntimeMinutes === 0 ? "no cap" : `${ctx.maxRuntimeMinutes} min`;
  const confirmStr = ctx.confirmationEnabled ? "enabled" : "disabled";

  let block = "---\n";
  block += "# Loop Context\n\n";
  block += "You are running inside the ralph agent loop, not in an interactive session.\n";
  block +=
    "The loop invokes you repeatedly until all tasks complete or a stop condition is reached.\n\n";
  block += `Iteration: ${iterStr}\n`;
  block += `Cost so far: $${ctx.currentCostUsd.toFixed(2)} (cap: ${costCapStr})\n`;
  block += `Runtime: ${ctx.elapsedMinutes} min elapsed (cap: ${runtimeCapStr})\n`;
  block += `Pass type: ${ctx.pass}\n`;
  block += `Confirmation gate: ${confirmStr}, round ${ctx.confirmationRound}\n`;
  block += "---\n\n";
  return block;
}

/**
 * Return the static stage-specific guidance block for the given OpenSpec phase.
 */
export function getStageBlock(ospPhase: OpenSpecPhase): string {
  const GUIDANCE: Record<OpenSpecPhase, string> = {
    proposal:
      "Understand requirements; produce or refine proposal.md before anything else. " +
      "Do not write code or create tasks until proposal.md is complete.",
    design:
      "Produce or refine design.md with files to touch, data flow, and edge cases. " +
      "Do not implement any code changes until design.md is complete.",
    tasks:
      "Break work into atomic `- [ ]` items in tasks.md under `## Section` headings. " +
      "Each item must be independently completable. Do not start implementation yet.",
    implement:
      "Execute tasks one at a time; commit before moving to the next. " +
      "Do not jump ahead or modify tasks that are not yet active.",
    review:
      "Audit implementation against acceptance criteria; document findings in review-findings.md. " +
      "Do not add new features or fix issues in this phase — only audit and document.",
    done:
      "Change is complete. Verify state is clean, all tasks are checked off, " +
      "and no uncommitted changes remain.",
  };
  return `---\n# Stage: ${ospPhase}\n\n${GUIDANCE[ospPhase]}\n---\n\n`;
}

/**
 * Build the per-variable behavioral premises block from runtime state.
 * Omits premises when caps are 0/unlimited or optional fields are absent.
 */
export function buildDynamicLoopBlock(ctx: LoopPreambleContext): string {
  const paragraphs: string[] = [];

  // Iteration convergence pressure
  if (ctx.maxIterations > 0) {
    const remaining = ctx.maxIterations - ctx.currentIteration;
    const pressure = remaining <= 2 ? "high" : remaining <= 5 ? "moderate" : "low";
    paragraphs.push(
      `Convergence pressure is ${pressure}: ${remaining} iteration(s) remain of ${ctx.maxIterations}. ` +
        `${remaining <= 2 ? "Prefer completing in-progress work over exploring new paths." : "Continue with the best next action; exploration is still viable."}`,
    );
  }

  // Cost depth
  if (ctx.maxCostUsd > 0) {
    const pct = Math.round((ctx.currentCostUsd / ctx.maxCostUsd) * 100);
    paragraphs.push(
      `Cost usage: $${ctx.currentCostUsd.toFixed(2)} of $${ctx.maxCostUsd.toFixed(2)} (${pct}% used). ` +
        `${pct >= 80 ? "Prefer the cheapest acceptable path to completion." : "Investigation depth is acceptable at current cost level."}`,
    );
  }

  // Runtime wrap-up
  if (ctx.maxRuntimeMinutes > 0) {
    const remaining = ctx.maxRuntimeMinutes - ctx.elapsedMinutes;
    paragraphs.push(
      `Runtime: ${ctx.elapsedMinutes} min elapsed, ${remaining} min remaining of ${ctx.maxRuntimeMinutes} min cap. ` +
        `${remaining <= 5 ? "Wrap up cleanly rather than starting new work." : "Starting another action is fine at current pace."}`,
    );
  }

  // Confirmation gate
  if (ctx.confirmationEnabled) {
    paragraphs.push(
      "The confirmation gate is enabled: the loop may pause for user approval before proceeding. " +
        "Do not assume uninterrupted execution.",
    );
  }

  // Confirmation round
  if (ctx.confirmationRound === 1) {
    paragraphs.push(
      "This is the first confirmation round: focus on planning and presenting a clear proposal before execution.",
    );
  } else if (ctx.confirmationRound > 1) {
    paragraphs.push(
      `This is confirmation round ${ctx.confirmationRound}: revise your approach against prior feedback before proceeding.`,
    );
  }

  // Pass type
  if (ctx.pass === "normal") {
    paragraphs.push(
      "Pass type is normal: follow the default orchestration and choose the best next stage action.",
    );
  } else if (ctx.pass === "confirmation") {
    paragraphs.push(
      "Pass type is confirmation: refine and present the plan; avoid premature execution until the user approves.",
    );
  } else if (ctx.pass === "ci-fix") {
    paragraphs.push(
      "Pass type is ci-fix: focus narrowly on CI diagnosis and remediation. " +
        "Do not make unrelated changes.",
    );
  } else if (ctx.pass === "conflict-resolution") {
    paragraphs.push(
      "Pass type is conflict-resolution: resolve merge or rebase conflicts safely, " +
        "preserving the original intent of both sides.",
    );
  }

  // Feature flags
  if (ctx.createPrOnSuccess) {
    paragraphs.push(
      "A PR will be created on success: prepare the branch and commit history for PR creation or update.",
    );
  }
  if (ctx.stackPrsOnDependencies) {
    paragraphs.push(
      "PRs are stacked on dependencies: sequence and finalize changes in dependency-aware order.",
    );
  }
  if (ctx.syncTasksToComment) {
    paragraphs.push(
      "Task progress is synced to issue comments: keep loop progress aligned with the linked issue.",
    );
  }

  // Worktree context
  if (ctx.useWorktree && ctx.worktreePath) {
    paragraphs.push(
      `All file and path operations must be relative to the active worktree root: \`${ctx.worktreePath}\`.`,
    );
  }

  // Issue context
  if (ctx.issueIdentifier) {
    const urlPart = ctx.issueUrl ? ` (${ctx.issueUrl})` : "";
    paragraphs.push(
      `This run is anchored to issue ${ctx.issueIdentifier}${urlPart}. Use the issue's workflow context to inform decisions.`,
    );
  }

  if (paragraphs.length === 0) return "";
  return `---\n# Dynamic Loop Context\n\n${paragraphs.join("\n\n")}\n---\n\n`;
}

/**
 * Build the full loop-level prompt by composing:
 * 1. Loop preamble
 * 2. Stage-specific block
 * 3. Dynamic loop block
 * 4. Phase prompt (existing buildPhasePrompt output)
 */
export function buildLoopLevelPrompt(
  phase: TaskPhase,
  ospPhase: OpenSpecPhase,
  state: State,
  taskDir: string,
  ctx: LoopPreambleContext,
  reviewPhase?: ReviewPhaseConfig,
): string {
  return (
    buildLoopPreamble(ctx) +
    getStageBlock(ospPhase) +
    buildDynamicLoopBlock(ctx) +
    buildPhasePrompt(phase, state, taskDir, reviewPhase)
  );
}
