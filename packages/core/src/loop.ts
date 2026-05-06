import { join } from "node:path";
import type { State, IterationUsage } from "@ralphy/types";
import { updateState } from "./state";
import { getStorage } from "@ralphy/context";

/**
 * Minimal change-store operations required by the loop.
 * Satisfied structurally by ChangeStore from @ralphy/change-store.
 */
export interface LoopChangeStore {
  archiveChange(name: string): Promise<void>;
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
  statesDir: string;
  tasksDir: string;
  changeStore: LoopChangeStore;
}

const STEERING_MAX_LINES = 20;

/**
 * Extract the first unchecked section from tasks.md.
 * A section starts with a `## ` heading and contains `- [ ]` items.
 * Returns the first such section that has at least one unchecked item.
 *
 * Falls back to the entire trimmed file when there are no `## ` headings
 * but unchecked items exist (e.g. a flat top-level checklist).
 */
export function extractFirstUncheckedSection(tasksContent: string): string | null {
  const sections = tasksContent.split(/(?=^## )/m);
  for (const section of sections) {
    if (/^## /m.test(section) && /^- \[ \]/m.test(section)) return section.trim();
  }
  if (/^- \[ \]/m.test(tasksContent)) return tasksContent.trim();
  return null;
}

/**
 * Count unchecked `- [ ]` items in a tasks.md content string.
 */
export function countUncheckedTasks(tasksContent: string): number {
  return (tasksContent.match(/^- \[ \]/gm) ?? []).length;
}

/**
 * Check whether all tasks in tasks.md are completed (no unchecked items).
 */
export function allTasksCompleted(tasksContent: string): boolean {
  return !/^- \[ \]/m.test(tasksContent);
}

/**
 * Build the full prompt for a change iteration by concatenating:
 * 1. Steering section from proposal.md (first 20 non-header lines)
 * 2. First unchecked section of tasks.md
 */
export function buildTaskPrompt(state: State, taskDir: string): string {
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

  // 2. First unchecked section from tasks.md, or initial prompt if no tasks yet
  const tasksContent = storage.read(join(taskDir, "tasks.md"));
  if (tasksContent !== null) {
    const section = extractFirstUncheckedSection(tasksContent);
    if (section) {
      prompt += "---\n\n## Current Task Section\n\n";
      prompt += section + "\n\n";
      prompt += "---\n\n";
      prompt +=
        `**Tracking progress**: as you finish each item above, edit ` +
        `\`${join(taskDir, "tasks.md")}\` and change its \`- [ ]\` to ` +
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

  // 3. Base context: change name and instructions
  prompt += `Change name: \`${state.name}\`\n\n`;
  prompt += `Run \`bunx openspec validate ${state.name}\` before committing.\n`;

  return prompt;
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
