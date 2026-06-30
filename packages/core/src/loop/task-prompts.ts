import { join } from "node:path";
import type { State } from "@ralphy/types";
import { getStorage } from "@ralphy/context";
import {
  firstUnchecked,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
  HANDOFF_FILENAME,
} from "../tasks-md";
import {
  countOpenFindings as countOpenFindingsInContent,
  deriveOpenSpecPhase,
} from "../openspec/phase";
import { buildMetaPrompt, type MetaPromptOptions, type TaskPhase } from "../prompt/meta-prompt";
import { SELF_REVIEW_FAILURE_CLASSES } from "../prompt/project-rules";
import type { ReviewPhaseConfig } from "../loop";

const STEERING_MAX_LINES = 20;

/**
 * Build the full prompt for a change iteration by concatenating:
 * 1. Steering section from proposal.md (first 20 non-header lines)
 * 2. First unchecked section of tasks.md
 * 3. Manual testing instruction if enabled and primary tasks complete
 * 4. Review phase instruction if enabled and all tasks are done
 */
export function buildTaskPrompt(
  state: State,
  taskDir: string,
  reviewPhase?: ReviewPhaseConfig,
): string {
  const storage = getStorage();
  let prompt = "";

  // 1. Steering from steering.md
  const steeringContent = storage.read(join(taskDir, "steering.md"));
  if (steeringContent !== null) {
    const steeringLines = steeringContent
      .split("\n")
      .filter((line) => !line.startsWith("#"))
      .filter((line) => line.trim())
      .slice(0, STEERING_MAX_LINES);

    if (steeringLines.length > 0) {
      prompt += "---\n";
      prompt += "# User Steering (READ FIRST)\n\n";
      prompt += steeringLines.join("\n") + "\n\n";
      prompt += "---\n\n";
    }
  }

  // 1b. Previous-iteration handoff (loop scratch written by the prior
  //     iteration's agent). Injected after steering so the agent reads
  //     user guidance first, then last-iteration context, then the task.
  //     Empty/whitespace-only content is treated as absent.
  const handoffContent = storage.read(join(taskDir, HANDOFF_FILENAME));
  if (handoffContent !== null && handoffContent.trim()) {
    prompt += "---\n";
    prompt += "# Previous Iteration Handoff (context from the last iteration)\n\n";
    prompt += handoffContent.trim() + "\n\n";
    prompt += "---\n\n";
  }

  // 2. Pick the active tasks file. Prefer agent-tasks.md when it has
  //    unchecked items so internal flow tasks (CI repair, push reject,
  //    merge conflicts, …) preempt mission work. Fall back to tasks.md.
  const agentTasksPath = join(taskDir, AGENT_TASKS_FILENAME);
  const missionTasksPath = join(taskDir, MISSION_TASKS_FILENAME);
  const agentTasksContent = storage.read(agentTasksPath);
  const missionTasksContent = storage.read(missionTasksPath);
  let activePath: string | null = null;
  let activeContent: string | null = null;
  if (agentTasksContent !== null && /^- \[ \]/m.test(agentTasksContent)) {
    activePath = agentTasksPath;
    activeContent = agentTasksContent;
  } else if (missionTasksContent !== null) {
    activePath = missionTasksPath;
    activeContent = missionTasksContent;
  }
  if (activeContent !== null && activePath !== null) {
    const section = firstUnchecked(activeContent);
    if (section) {
      prompt += "---\n\n## Current Task Section\n\n";
      prompt += section + "\n\n";
      prompt += "---\n\n";
      prompt +=
        `**Tracking progress**: as you finish each item above, edit ` +
        `\`${activePath}\` and change its \`- [ ]\` to ` +
        `\`- [x]\` in the same commit. The loop reads this file between ` +
        `iterations and stops when no \`- [ ]\` items remain — if you do ` +
        `not tick the box, the next iteration will repeat this task.\n\n`;
    }
  } else if (state.prompt) {
    prompt += "---\n\n## Initial Prompt\n\n";
    prompt += state.prompt + "\n\n";
    prompt += "---\n\n";
    prompt += `**First action**: create \`${taskDir}/tasks.md\` with a checklist of all work items derived from the prompt above (use \`## Section\` headings with \`- [ ] task\` items). Then begin the first unchecked item.\n\n`;
  }

  // 3. Manual testing instruction (if enabled and no more tasks).
  //    Waits until both the mission tasks and any internal flow tasks
  //    have been ticked off so the manual phase doesn't slip in while
  //    the agent is still recovering from a runtime failure.
  if (state.manualTest) {
    const tasksContent = missionTasksContent;
    const hasUncheckedMission = tasksContent !== null && /^- \[ \]/m.test(tasksContent);
    const hasUncheckedAgent = agentTasksContent !== null && /^- \[ \]/m.test(agentTasksContent);
    if (!hasUncheckedMission && !hasUncheckedAgent) {
      const hasManualTestSection =
        tasksContent !== null && /^## Manual Testing/m.test(tasksContent);
      if (!hasManualTestSection) {
        prompt += "---\n\n## Manual Testing Phase\n\n";
        prompt +=
          "All primary implementation tasks are complete. Now create manual test tasks.\n\n";
        prompt += "1. Analyze the specification and implementation\n";
        prompt +=
          "2. Identify critical manual test scenarios (UI interactions, edge cases, user workflows, integration testing)\n";
        prompt +=
          "3. Add a `## Manual Testing` section to tasks.md with test items as `- [ ] Test scenario description`\n";
        prompt += "4. Complete each test and check it off when done\n\n";
        prompt += "---\n\n";
      }
    }
  }

  // 4. Review phase injection (when enabled and all tasks are complete).
  //    (a) No review-findings.md yet → instruct the agent to run a review pass.
  //    (b) review-findings.md has open findings and under cap → instruct the
  //        agent to address those findings before the next review.
  if (reviewPhase?.enabled) {
    const reviewFindingsPath = join(taskDir, "review-findings.md");
    const reviewFindingsContent = storage.read(reviewFindingsPath);
    const hasUncheckedMission =
      missionTasksContent !== null && /^- \[ \]/m.test(missionTasksContent);
    const hasUncheckedAgent = agentTasksContent !== null && /^- \[ \]/m.test(agentTasksContent);
    const allDone = !hasUncheckedMission && !hasUncheckedAgent;

    if (allDone) {
      if (reviewFindingsContent === null) {
        prompt += "---\n\n## Self-Review Phase\n\n";
        prompt += "All implementation tasks are complete. Run a self-review before closing:\n\n";
        prompt += "1. Read `proposal.md` and `design.md` from `openspec/changes/<change-name>/`.\n";
        prompt += "2. Run `git diff main` to review all changes in this branch.\n";
        prompt += "3. Check the implementation against the acceptance criteria in `proposal.md`.\n";
        prompt +=
          "4. Audit the diff against these recurring failure classes, not just the acceptance criteria:\n\n";
        prompt += `${SELF_REVIEW_FAILURE_CLASSES}\n\n`;
        prompt += `5. Write findings to \`${reviewFindingsPath}\`:\n`;
        prompt += "   - If issues found: list them as `- [ ] <finding>` under `## Open`.\n";
        prompt += "   - If no issues: write `(no findings — close round)` under `## Open`.\n\n";
        prompt += "---\n\n";
      } else {
        const openCount = countOpenFindingsInContent(reviewFindingsContent);
        if (openCount > 0 && state.reviewRounds < reviewPhase.maxRounds) {
          prompt += "---\n\n## Address Review Findings\n\n";
          prompt += `There are ${openCount} open finding(s) from the self-review. Address them before finishing:\n\n`;
          prompt += `1. Read \`${reviewFindingsPath}\` to see the open findings.\n`;
          prompt += "2. Fix each `- [ ]` item under `## Open`.\n";
          prompt += "3. Check off each finding as you resolve it (`- [x]`).\n";
          prompt +=
            "4. When all findings are resolved, write a new review pass (update the file with `(no findings — close round)` or any remaining open items).\n\n";
          prompt += "---\n\n";
        }
      }
    }
  }

  // 5. Base context: change name and instructions
  prompt += `Change name: \`${state.name}\`\n\n`;
  const validateOnly = state.validateOnComplete && !state.createPr;
  if (!validateOnly) {
    prompt += `Run \`bunx openspec validate ${state.name}\` before committing.\n`;
  }
  prompt += `Commit all changed files yourself before finishing — stage files individually (e.g. \`git add path/to/file\`), never \`git add -A\` or \`git commit -am\`. Nothing is committed automatically after you exit.\n`;

  if (state.createPr) {
    prompt += `\nWhen all tasks are complete and all files are committed, push your branch and open a pull request:\n`;
    prompt += `  git push -u origin HEAD\n`;
    const draftFlag = state.prDraft ? " --draft" : "";
    prompt += `  gh pr create${draftFlag} --title "${state.name}" --body "Summary of changes for ${state.name}"\n`;
    prompt += `Use the change name as the PR title and write a concise summary of the implementation in the body.\n`;
  }

  // 6. Write-handoff instruction (always present, even on the first
  //    iteration). The agent records short-term memory for the next
  //    iteration to read back via the block injected above.
  const handoffPath = join(taskDir, HANDOFF_FILENAME);
  prompt += `\n---\n\n## Write Handoff (do this LAST, before you finish)\n`;
  prompt += `Before ending this iteration, record a handoff for the next iteration:\n`;
  prompt += `- If a \`handoff\` skill is available, invoke it; otherwise write the document yourself.\n`;
  prompt += `- Save it to \`${handoffPath}\` (OVERWRITE the existing file — do NOT append, do NOT save to a temp dir).\n`;
  prompt += `- Keep it compact: what you did this iteration, what remains, key decisions, and any blockers/gotchas. Reference artifacts by path instead of duplicating them.\n`;
  prompt += `- This file is loop scratch — do NOT commit it.\n`;

  return prompt;
}

function buildSteeringBlock(taskDir: string): string {
  const storage = getStorage();
  const steeringContent = storage.read(join(taskDir, "steering.md"));
  if (steeringContent === null) return "";
  const steeringLines = steeringContent
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .filter((line) => line.trim())
    .slice(0, STEERING_MAX_LINES);
  if (steeringLines.length === 0) return "";
  return `---\n# User Steering (READ FIRST)\n\n${steeringLines.join("\n")}\n\n---\n\n`;
}

/** Build a research-phase prompt that instructs the agent to explore without changing code. */
export function buildResearchPrompt(state: State, taskDir: string): string {
  let prompt = buildSteeringBlock(taskDir);

  prompt += "---\n\n## Research Phase\n\n";
  prompt += `Change name: \`${state.name}\`\n\n`;

  if (state.prompt) {
    prompt += "## Task Description\n\n";
    prompt += state.prompt + "\n\n";
  }

  prompt +=
    "Your goal in this phase is to explore and understand the codebase. Do not implement any changes.\n\n";
  prompt += `1. Read \`openspec/changes/${state.name}/proposal.md\` if it exists to understand the problem.\n`;
  prompt += "2. Explore the codebase structure relevant to this change.\n";
  prompt += "3. Identify all files that will need to be modified or created.\n";
  prompt += `4. Write a research summary to \`${taskDir}/research.md\` with:\n`;
  prompt += "   - Relevant files and their current state\n";
  prompt += "   - Key patterns and conventions to follow\n";
  prompt += "   - Potential risks or blockers\n\n";
  prompt += "---\n\n";

  return prompt;
}

/** Build a planning-phase prompt that instructs the agent to produce proposal/design/tasks artifacts. */
export function buildPlanPrompt(state: State, taskDir: string): string {
  let prompt = buildSteeringBlock(taskDir);

  prompt += "---\n\n## Planning Phase\n\n";
  prompt += `Change name: \`${state.name}\`\n\n`;

  if (state.prompt) {
    prompt += "## Task Description\n\n";
    prompt += state.prompt + "\n\n";
  }

  prompt +=
    "Your goal in this phase is to produce a complete technical plan. Do not implement any code yet.\n\n";
  prompt += "Produce or update the following artifacts:\n\n";
  prompt += `1. \`openspec/changes/${state.name}/proposal.md\` — Fill in \`## Why\`, \`## What Changes\`, and \`## Acceptance Criteria\` sections.\n`;
  prompt += `2. \`openspec/changes/${state.name}/design.md\` — Technical design: files to touch, data flow, edge cases.\n`;
  prompt += `3. \`${taskDir}/tasks.md\` — Implementation checklist with \`## Section\` headings and \`- [ ] task\` items.\n\n`;
  prompt += `Run \`bunx openspec validate ${state.name}\` and fix any validation errors before finishing.\n\n`;
  prompt += "---\n\n";

  return prompt;
}

/** Build a review-phase prompt that instructs the agent to audit the implementation. */
export function buildReviewPrompt(state: State, taskDir: string): string {
  const reviewFindingsPath = join(taskDir, "review-findings.md");
  let prompt = buildSteeringBlock(taskDir);

  prompt += "---\n\n## Review Phase\n\n";
  prompt += `You are reviewing change \`${state.name}\`. Audit the implementation against the spec.\n\n`;
  prompt += `1. Read \`openspec/changes/${state.name}/proposal.md\` and \`openspec/changes/${state.name}/design.md\`.\n`;
  prompt += "2. Run `git diff main` to review all changes in this branch.\n";
  prompt += "3. Check the implementation against the acceptance criteria in `proposal.md`.\n";
  prompt +=
    "4. Audit the diff against these recurring failure classes, not just the acceptance criteria:\n\n";
  prompt += `${SELF_REVIEW_FAILURE_CLASSES}\n\n`;
  prompt += `5. Write findings to \`${reviewFindingsPath}\`:\n`;
  prompt += "   - If issues found: list them as `- [ ] <finding>` under `## Open`.\n";
  prompt += "   - If no issues: write `(no findings — close round)` under `## Open`.\n\n";
  prompt += "Do not implement any fixes in this phase. Only audit and document findings.\n\n";
  prompt += "---\n\n";
  prompt += `Change name: \`${state.name}\`\n\n`;

  return prompt;
}

export interface TaskPhaseArtifacts {
  /** Contents of `proposal.md`, or `null` if the file does not exist. */
  proposal: string | null;
  /** Contents of `design.md`, or `null` if the file does not exist. */
  design: string | null;
  /** Contents of `tasks.md`, or `null` if the file does not exist. */
  tasks: string | null;
}

/**
 * Pick the `TaskPhase` prompt to run for the next iteration. When the caller
 * pins `optsPhase`, honor it. Otherwise inspect mission artifacts and route
 * proposal/design states back to `plan` so the worker authors the missing
 * artifacts instead of falling through to `execute` and chewing on
 * `agent-tasks.md` flow items forever.
 */
export function routeTaskPhase(
  optsPhase: TaskPhase | undefined,
  artifacts: TaskPhaseArtifacts,
): TaskPhase {
  if (optsPhase !== undefined) return optsPhase;
  const ospPhase = deriveOpenSpecPhase({
    proposal: artifacts.proposal,
    design: artifacts.design,
    tasks: artifacts.tasks,
    reviewFindings: null,
    reviewRounds: 0,
    maxReviewRounds: 0,
  });
  if (ospPhase === "proposal" || ospPhase === "design") return "plan";
  return "execute";
}

/** Route to the correct prompt builder based on the requested phase. */
export function buildPhasePrompt(
  phase: TaskPhase,
  state: State,
  taskDir: string,
  reviewPhase?: ReviewPhaseConfig,
  metaPromptOptions?: MetaPromptOptions,
): string {
  const meta = buildMetaPrompt(state, phase, metaPromptOptions);
  let phasePrompt: string;
  switch (phase) {
    case "research":
      phasePrompt = buildResearchPrompt(state, taskDir);
      break;
    case "plan":
      phasePrompt = buildPlanPrompt(state, taskDir);
      break;
    case "execute":
      phasePrompt = buildTaskPrompt(state, taskDir, reviewPhase);
      break;
    case "review":
      phasePrompt = buildReviewPrompt(state, taskDir);
      break;
  }
  return meta + phasePrompt;
}
