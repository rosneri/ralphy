import { join } from "node:path";
import { VERSION } from "@ralphy/version";
import type { State, IterationUsage } from "@ralphy/types";
import { updateState } from "../state";
import { getStorage } from "@ralphy/context";

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
 * Stop reason a loop run ends with. Derived from the `loopMachine` stopped
 * state (`stoppedStateToReason`) — the machine's guards are the only stop
 * arithmetic; there is no imperative re-implementation.
 */
export const STOP_REASONS = [
  "maxIterations",
  "completed",
  "costCap",
  "runtimeLimit",
  "consecutiveFailures",
  "rateLimited",
  /** All tasks were checked off but the worktree still has uncommitted
   *  edits. The loop refuses to archive a change with stranded work — a
   *  human (or a follow-up reset of `tasks.md`) decides next. See LIT-303. */
  "stranded",
] as const;

/**
 * Single source of truth: the machine-level stop reasons. `StopReason` is
 * derived from this tuple, `stoppedStateToReason` validates against it, and
 * the `loopMachine` stopped substates are pinned to it by a test.
 */
export type StopReason = (typeof STOP_REASONS)[number];

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
          appVersion: VERSION,
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
