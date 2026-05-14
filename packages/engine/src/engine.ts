import { spawn } from "./spawn";
import { mkdtemp, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Engine, type IterationUsage } from "@ralphy/types";
import { type FeedEvent } from "./feed-events";
import { type ConsumeResult, type EngineAdapter, consumeEngineEvents } from "./adapter";
import { createClaudeAdapter } from "./adapters/claude";
import { createCodexAdapter } from "./adapters/codex";

export interface RunEngineOptions {
  engine: Engine;
  model: string;
  prompt: string;
  logFlag?: boolean;
  /** When `logFlag` is true, append the raw engine stdout (and stderr for codex)
   *  as newline-delimited JSON to this file. Caller picks the path. */
  logFile?: string;
  taskDir?: string;
  interactive?: boolean;
  cwd?: string;
  onOutput?: (line: string) => void;
  onFeedEvent?: (event: FeedEvent) => void;
  /** AbortSignal to kill the engine process (used for live steering). */
  signal?: AbortSignal;
  /** Resume an existing Claude session instead of starting fresh. */
  resumeSessionId?: string;
  /**
   * Inject a pre-built EngineAdapter (e.g. the scripted adapter) instead of
   * spawning. Production callers should leave this unset; tests use it to
   * exercise engine-level behavior without a subprocess.
   */
  adapter?: EngineAdapter;
}

export type EngineResult = ConsumeResult;

/**
 * Handle engine failure by exit code.
 * Returns a human-readable error message and whether the loop should stop.
 */
export function handleEngineFailure(exitCode: number): {
  message: string;
  shouldStop: boolean;
} {
  switch (exitCode) {
    case 42:
      return {
        message: "Rate limited — Codex rate limit hit. Stopping loop.",
        shouldStop: true,
      };
    case 130:
      return {
        message: "Interrupted (exit 130) — Claude hit usage limits or was cancelled (SIGINT).",
        shouldStop: false,
      };
    case 137:
      return {
        message: "Killed (exit 137) — Process was killed (SIGKILL / OOM).",
        shouldStop: false,
      };
    case 1:
      return {
        message: "Failed (exit 1) — Engine exited with a general error.",
        shouldStop: false,
      };
    default:
      return {
        message: `Failed (exit ${exitCode}) — Engine exited unexpectedly.`,
        shouldStop: false,
      };
  }
}

/**
 * Spawn Claude in interactive mode with inherited stdio.
 * The user can chat back and forth. Returns when the session ends.
 */
async function runInteractive(
  model: string,
  prompt: string,
  taskDir?: string,
): Promise<EngineResult> {
  const promptFile = taskDir
    ? join(taskDir, "_interactive_prompt.md")
    : join(await mkdtemp(join(tmpdir(), "ralph-")), "prompt.md");
  await Bun.write(promptFile, prompt);

  try {
    const cmd = [
      "claude",
      "--model",
      model,
      "--dangerously-skip-permissions",
      [
        `Read the file ${promptFile} for background on the task.`,
        `Start by using /plan mode. Ask the user clarifying questions to deeply understand the requirements,`,
        `constraints, edge cases, and preferences. Do not rush — thorough understanding is the goal.`,
        `Once the user is satisfied and approves, call the mcp__ralph__ralph_finish_interactive MCP tool with the task name`,
        `and a comprehensive context summary of everything discussed: refined requirements, architectural decisions,`,
        `constraints, edge cases, and user preferences.`,
        `The automated loop will then run all phases (research, plan, exec, review) using this context.`,
        `After calling mcp__ralph__ralph_finish_interactive, use /exit immediately.`,
      ].join(" "),
    ];

    const proc = spawn({
      cmd,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;

    const doneFile = taskDir ? join(taskDir, "_interactive_done") : null;
    if (doneFile && (await Bun.file(doneFile).exists())) {
      return { exitCode: 0, usage: null, sessionId: null, rateLimited: false };
    }

    return { exitCode, usage: null, sessionId: null, rateLimited: false };
  } finally {
    try {
      await unlink(promptFile);
    } catch {
      // cleanup is best-effort
    }
  }
}

/**
 * Run the engine: build the appropriate adapter (or use the injected one),
 * stream events to the caller, and aggregate session/usage/exit state.
 */
export async function runEngine(opts: RunEngineOptions): Promise<EngineResult> {
  const { engine, model, prompt } = opts;

  if (opts.interactive && engine === "claude") {
    return runInteractive(model, prompt, opts.taskDir);
  }

  const adapter =
    opts.adapter ??
    (engine === "claude"
      ? createClaudeAdapter({
          model,
          prompt,
          ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          ...(opts.logFile ? { logFile: opts.logFile } : {}),
          ...(opts.logFlag !== undefined ? { logFlag: opts.logFlag } : {}),
        })
      : createCodexAdapter({
          prompt,
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
          ...(opts.logFile ? { logFile: opts.logFile } : {}),
          ...(opts.logFlag !== undefined ? { logFlag: opts.logFlag } : {}),
        }));

  return consumeEngineEvents(adapter, {
    engine,
    ...(opts.onFeedEvent ? { onFeedEvent: opts.onFeedEvent } : {}),
    ...(opts.onOutput ? { onOutput: opts.onOutput } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
}

// Re-exports so package consumers can keep importing from "@ralphy/engine/engine".
export { consumeEngineEvents } from "./adapter";
export type { EngineAdapter, ConsumeOptions, ConsumeResult } from "./adapter";
export type { IterationUsage };
