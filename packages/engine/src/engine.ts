import { spawn } from "./spawn";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdtemp, unlink, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { type Engine, type IterationUsage } from "@ralphy/types";
import { type FeedEvent, renderFeedEvent } from "./feed-events";
import { parseClaudeLine } from "./formatters/claude-stream";
import {
  createCodexAdapter,
  type AgentAdapter,
  type AgentAdapterOptions,
  type AgentAdapterResult,
} from "@ralphy/adapter-codex";

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

function buildClaudeArgs(model: string, resumeSessionId?: string): string[] {
  const args = [
    "-p",
    "-",
    "--dangerously-skip-permissions",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }
  return args;
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

const createClaudeAdapter: AgentAdapter = async (opts: AgentAdapterOptions) => {
  const proc = spawn({
    cmd: ["claude", ...buildClaudeArgs(opts.model, opts.resumeSessionId)],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
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

  const stdin = proc.stdin as import("bun").FileSink;
  stdin.write(new TextEncoder().encode(opts.prompt));
  await stdin.flush();
  stdin.end();

  const writeRaw = (line: string) => {
    if (opts.onRawLine) opts.onRawLine(line);
  };

  const claudeState = {
    turnCount: 0,
    toolCount: 0,
    gotResult: false,
    usage: null as IterationUsage | null,
  };

  let sessionId: string | null = null;
  let detectedRateLimit = false;

  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  for await (const line of streamLines(stdout)) {
    writeRaw(line);
    if (sessionId === null) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "system" && parsed.subtype === "init" && parsed.session_id) {
          sessionId = parsed.session_id as string;
        }
      } catch {
        // not JSON, skip
      }
    }

    for (const event of parseClaudeLine(line, claudeState)) {
      if (event.type === "text" && isRateLimitText(event.text)) {
        detectedRateLimit = true;
      }
      opts.onFeedEvent(event);
    }
    if (claudeState.gotResult) {
      killProc();
      break;
    }
  }

  const exitCode = await proc.exited;
  const wasIntentionalKill = intentionalKill && (exitCode === 143 || exitCode === 137);
  const normalizedExitCode = wasIntentionalKill ? 0 : exitCode;

  return {
    exitCode: normalizedExitCode,
    usage: claudeState.usage,
    sessionId,
    rateLimited: detectedRateLimit,
  };
};

const adapters: Record<Engine, AgentAdapter> = {
  claude: createClaudeAdapter,
  codex: createCodexAdapter,
};

export async function runEngine(opts: RunEngineOptions): Promise<EngineResult> {
  const { engine, model, prompt } = opts;
  const write = opts.onOutput ?? ((l: string) => process.stdout.write(l + "\n"));

  if (opts.interactive && engine === "claude") {
    return runInteractive(model, prompt, opts.taskDir);
  }

  let rawWriter: WriteStream | null = null;
  if (opts.logFlag && opts.logFile) {
    await mkdir(dirname(opts.logFile), { recursive: true });
    rawWriter = createWriteStream(opts.logFile, { flags: "a" });
  }
  const writeRaw = (line: string) => {
    if (rawWriter) rawWriter.write(line + "\n");
  };
  const closeRaw = () =>
    new Promise<void>((resolve) => {
      if (!rawWriter) return resolve();
      rawWriter.end(resolve);
    });

  const emit = opts.onFeedEvent;
  function emitEvent(event: FeedEvent): void {
    if (emit) {
      emit(event);
    } else {
      for (const l of renderFeedEvent(event)) {
        write(l);
      }
    }
  }

  const adapter = adapters[engine];
  const adapterOpts: AgentAdapterOptions = {
    model,
    prompt,
    onFeedEvent: emitEvent,
    onRawLine: writeRaw,
  };
  if (opts.cwd !== undefined) adapterOpts.cwd = opts.cwd;
  if (opts.signal !== undefined) adapterOpts.signal = opts.signal;
  if (opts.resumeSessionId !== undefined) adapterOpts.resumeSessionId = opts.resumeSessionId;

  let result: AgentAdapterResult;
  try {
    result = await adapter(adapterOpts);
  } finally {
    await closeRaw();
  }

  return result;
}

/** Patterns that indicate the engine hit an API rate / usage limit. */
const RATE_LIMIT_PATTERNS = [/you've hit your limit/i, /rate limit/i, /too many requests/i];

function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}
