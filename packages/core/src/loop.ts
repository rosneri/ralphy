import { join } from "node:path";
import type { State, IterationUsage } from "@ralphy/types";
import type { ChangeStatus } from "@ralphy/change-store";
import { updateState } from "./state";
import { getStorage } from "@ralphy/context";
import { firstUnchecked, AGENT_TASKS_FILENAME, MISSION_TASKS_FILENAME } from "./tasks-md";
import { countOpenFindings as countOpenFindingsInContent } from "./openspec/phase";
import { buildMetaPrompt, type MetaPromptOptions, type TaskPhase } from "./prompt/meta-prompt";

export type { MetaPromptOptions, TaskPhase } from "./prompt/meta-prompt";

// Re-export task utilities with standardized names for use in loop context
export {
  allCompleted as allTasksCompleted,
  countUnchecked as countUncheckedTasks,
  prependSection,
  prependFixTask,
  firstUnchecked as extractFirstUncheckedSection,
  pickActiveTasksFile,
  bothFilesCompleted,
  isFlowTaskHeading,
  FLOW_TASK_HEADING_PREFIXES,
  AGENT_TASKS_FILENAME,
  MISSION_TASKS_FILENAME,
} from "./tasks-md";

/**
 * Minimal change-store operations required by the loop.
 * Satisfied structurally by ChangeStore from @ralphy/change-store.
 */
export interface LoopChangeStore {
  archiveChange(name: string): Promise<void>;
  /** Optional: if provided, the loop uses this to detect "change archived
   *  externally" (tasks.md missing AND name no longer active) and exit
   *  instead of respawning forever on a no-op iteration. */
  listChanges?(): Promise<string[]>;
  /** Optional: if provided, the loop consults the canonical OpenSpec
   *  artifact status before archiving and refuses to archive while
   *  required artifacts are still pending. */
  getStatus?(name: string): Promise<ChangeStatus>;
}

export interface ReviewRoundResult {
  /** How many open findings the reviewer found. */
  openFindings: number;
  /** Which round number just completed (1-based). */
  roundNumber: number;
  /** Whether the cap was reached after this round. */
  capReached: boolean;
  /** Contents of review-findings.md (for attachment when cap reached). */
  findingsContent: string | null;
}

export interface LoopOptions {
  name: string;
  prompt: string;
  engine: string;
  model: string;
  maxIterations: number;
  maxCostUsd: number;
  maxRuntimeMinutes: number;
  maxConsecutiveFailures: number;
  delay: number;
  log: boolean;
  verbose: boolean;
  manualTest: boolean;
  createPr?: boolean;
  prDraft?: boolean;
  statesDir: string;
  tasksDir: string;
  changeStore: LoopChangeStore;
  /** Which prompt-building phase to use. Defaults to "execute". */
  phase?: TaskPhase;
  /** Review phase configuration. When provided and enabled, a fresh reviewer
   *  session is spawned after all tasks complete. */
  reviewPhase?: ReviewPhaseConfig & {
    reviewerModel?: string;
    reviewerContextStrategy?: "fresh" | "warm";
  };
  /** Called after each review round completes. Use to emit Linear comments. */
  onReviewRound?: (result: ReviewRoundResult) => Promise<void>;
  /** Options for the task-level meta-prompt layer. Pass enabled:false to opt out. */
  metaPrompt?: MetaPromptOptions;
}

const STEERING_MAX_LINES = 20;

export interface ReviewPhaseConfig {
  enabled: boolean;
  maxRounds: number;
}

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
        prompt += `4. Write findings to \`${reviewFindingsPath}\`:\n`;
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
  prompt += `4. Write findings to \`${reviewFindingsPath}\`:\n`;
  prompt += "   - If issues found: list them as `- [ ] <finding>` under `## Open`.\n";
  prompt += "   - If no issues: write `(no findings — close round)` under `## Open`.\n\n";
  prompt += "Do not implement any fixes in this phase. Only audit and document findings.\n\n";
  prompt += "---\n\n";
  prompt += `Change name: \`${state.name}\`\n\n`;

  return prompt;
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

/**
 * Check for a STOP signal file in the change directory.
 * If found, reads the reason, removes the file, marks state as blocked.
 * Returns the reason string if stopped, null otherwise.
 */
export function checkStopSignal(taskDir: string, stateDir: string): string | null {
  const storage = getStorage();
  const stopFile = join(taskDir, "STOP");
  const reason = storage.read(stopFile);
  if (reason === null) return null;

  storage.remove(stopFile);

  updateState(stateDir, (stateSnapshot) => ({
    ...stateSnapshot,
    status: "blocked",
    lastModified: new Date().toISOString(),
  }));

  return reason;
}

/**
 * Stop reason returned by checkStopCondition when the loop must end.
 */
export type StopReason =
  | "maxIterations"
  | "completed"
  | "costCap"
  | "runtimeLimit"
  | "consecutiveFailures"
  | "rateLimited";

/**
 * Determine whether the loop should continue.
 * Returns null if it should continue, or a reason string if it should stop.
 */
export function checkStopCondition(
  state: State,
  iteration: number,
  options: LoopOptions,
  startTime: number,
  consecutiveFailures: number,
): StopReason | null {
  if (options.maxIterations > 0 && iteration >= options.maxIterations) return "maxIterations";
  if (state.status !== "active") return "completed";
  if (options.maxCostUsd > 0 && state.usage.total_cost_usd >= options.maxCostUsd) return "costCap";
  if (options.maxRuntimeMinutes > 0) {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= options.maxRuntimeMinutes * 60_000) return "runtimeLimit";
  }
  if (options.maxConsecutiveFailures > 0 && consecutiveFailures >= options.maxConsecutiveFailures)
    return "consecutiveFailures";
  return null;
}

/**
 * Update state after a completed iteration.
 */
export function updateStateIteration(
  stateDir: string,
  result: string,
  startedAt: string,
  engine: string,
  model: string,
  usage: IterationUsage | null,
): State {
  return updateState(stateDir, (stateSnapshot) => {
    const now = new Date().toISOString();
    const newState: State = {
      ...stateSnapshot,
      iteration: stateSnapshot.iteration + 1,
      lastModified: now,
      engine: engine as State["engine"],
      model,
      history: [
        ...stateSnapshot.history,
        {
          timestamp: now,
          startedAt,
          endedAt: now,
          iteration: stateSnapshot.iteration + 1,
          engine,
          model,
          result,
          usage: usage
            ? {
                cost_usd: usage.cost_usd,
                duration_ms: usage.duration_ms,
                num_turns: usage.num_turns,
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
                cache_read_input_tokens: usage.cache_read_input_tokens,
                cache_creation_input_tokens: usage.cache_creation_input_tokens,
              }
            : undefined,
        },
      ],
    };

    // Accumulate usage totals if engine reported stats
    if (usage) {
      newState.usage = {
        total_cost_usd: stateSnapshot.usage.total_cost_usd + (usage.cost_usd ?? 0),
        total_duration_ms: stateSnapshot.usage.total_duration_ms + (usage.duration_ms ?? 0),
        total_turns: stateSnapshot.usage.total_turns + (usage.num_turns ?? 0),
        total_input_tokens: stateSnapshot.usage.total_input_tokens + (usage.input_tokens ?? 0),
        total_output_tokens: stateSnapshot.usage.total_output_tokens + (usage.output_tokens ?? 0),
        total_cache_read_input_tokens:
          stateSnapshot.usage.total_cache_read_input_tokens + (usage.cache_read_input_tokens ?? 0),
        total_cache_creation_input_tokens:
          stateSnapshot.usage.total_cache_creation_input_tokens +
          (usage.cache_creation_input_tokens ?? 0),
      };
    }

    return newState;
  });
}

/**
 * Append a steering message to steering.md (prepend-style, newest first).
 */
export function appendSteeringMessage(taskDir: string, message: string): void {
  const storage = getStorage();
  const steeringPath = join(taskDir, "steering.md");
  const existing = storage.read(steeringPath);
  const updated = existing ? `${message}\n\n${existing.trimStart()}` : `${message}\n`;
  storage.write(steeringPath, updated);
}

/**
 * Build a steering prompt to inject into a resumed session.
 */
export function buildSteeringPrompt(message: string): string {
  return [
    "LIVE STEERING UPDATE FROM USER:",
    "",
    message,
    "",
    "Continue your current task with this new guidance. Do not acknowledge the steering — just apply it.",
  ].join("\n");
}

/**
 * Merge usage stats from two engine runs (used when steering resumes a session).
 */
export function mergeUsage(
  base: IterationUsage | null,
  resumed: IterationUsage | null,
): IterationUsage | null {
  if (!base || !resumed) return resumed ?? base;
  return {
    cost_usd: (base.cost_usd ?? 0) + (resumed.cost_usd ?? 0),
    duration_ms: (base.duration_ms ?? 0) + (resumed.duration_ms ?? 0),
    num_turns: (base.num_turns ?? 0) + (resumed.num_turns ?? 0),
    input_tokens: (base.input_tokens ?? 0) + (resumed.input_tokens ?? 0),
    output_tokens: (base.output_tokens ?? 0) + (resumed.output_tokens ?? 0),
    cache_read_input_tokens:
      (base.cache_read_input_tokens ?? 0) + (resumed.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      (base.cache_creation_input_tokens ?? 0) + (resumed.cache_creation_input_tokens ?? 0),
  };
}
