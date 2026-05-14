import { spawn } from "./spawn";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Engine, type IterationUsage } from "@ralphy/types";
import { type FeedEvent, renderFeedEvent } from "./feed-events";
import { parseCodexLine } from "./formatters/codex-stream";
import { runClaude } from "@ralphy/adapter-claude";

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
}

export interface EngineResult {
  exitCode: number;
  usage: IterationUsage | null;
  /** Claude session ID, used for --resume on live steering. */
  sessionId: string | null;
  /** True when the engine hit an API rate / usage limit. */
  rateLimited: boolean;
}

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

function buildCodexArgs(): string[] {
  return ["exec", "--json", "--color", "never", "--dangerously-bypass-approvals-and-sandbox", "-"];
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
  // Write prompt to a temp file in the task dir so Claude can read it
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

    // Check if the interactive session completed successfully via the MCP tool signal
    // Keep the file — the loop uses it to avoid re-entering interactive mode
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

async function* streamLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      yield line;
    }
  }

  if (buffer.trim()) {
    yield buffer;
  }
}

export async function runEngine(opts: RunEngineOptions): Promise<EngineResult> {
  const { engine, model, prompt } = opts;
  const write = opts.onOutput ?? ((l: string) => process.stdout.write(l + "\n"));

  if (opts.interactive && engine === "claude") {
    return runInteractive(model, prompt, opts.taskDir);
  }

  const emit = opts.onFeedEvent;

  // Emit a FeedEvent: either via structured callback or fall back to chalk string
  function emitEvent(event: FeedEvent): void {
    if (emit) {
      emit(event);
    } else {
      for (const l of renderFeedEvent(event)) {
        write(l);
      }
    }
  }

  if (engine === "claude") {
    const claudeOpts: Parameters<typeof runClaude>[0] = {
      model,
      prompt,
      onEvent: emitEvent,
      spawn,
    };
    if (opts.resumeSessionId !== undefined) claudeOpts.resumeSessionId = opts.resumeSessionId;
    if (opts.cwd !== undefined) claudeOpts.cwd = opts.cwd;
    if (opts.logFlag && opts.logFile) claudeOpts.logFile = opts.logFile;
    if (opts.signal !== undefined) claudeOpts.signal = opts.signal;
    return runClaude(claudeOpts);
  }

  const proc = spawn({
    cmd: ["codex", ...buildCodexArgs()],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });

  let intentionalKill = false;
  const killProc = (): void => {
    intentionalKill = true;
    proc.kill();
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      killProc();
    } else {
      opts.signal.addEventListener("abort", killProc, { once: true });
    }
  }

  // Write prompt to stdin
  const stdin = proc.stdin as import("bun").FileSink;
  stdin.write(new TextEncoder().encode(prompt));
  await stdin.flush();
  stdin.end();

  let rawWriter: WriteStream | null = null;
  if (opts.logFlag && opts.logFile) {
    await mkdir(dirname(opts.logFile), { recursive: true });
    rawWriter = createWriteStream(opts.logFile, { flags: "a" });
  }
  const writeRaw = (line: string): void => {
    if (rawWriter) rawWriter.write(line + "\n");
  };
  const closeRaw = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (!rawWriter) return resolve();
      rawWriter.end(resolve);
    });

  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const codexState = {
    printingText: false,
    rateLimited: false,
    pendingTools: 0,
  };

  for await (const line of streamLines(stdout)) {
    writeRaw(line);
    for (const event of parseCodexLine(line, codexState)) {
      emitEvent(event);
    }
  }

  if (proc.stderr) {
    const stderr = proc.stderr as ReadableStream<Uint8Array>;
    for await (const line of streamLines(stderr)) {
      writeRaw(line);
      for (const event of parseCodexLine(line, codexState)) {
        emitEvent(event);
      }
    }
  }

  await closeRaw();

  const exitCode = await proc.exited;
  const wasIntentionalKill = intentionalKill && (exitCode === 143 || exitCode === 137);
  const normalizedExitCode = wasIntentionalKill ? 0 : exitCode;

  return { exitCode: normalizedExitCode, usage: null, sessionId: null, rateLimited: false };
}
