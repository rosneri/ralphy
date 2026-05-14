import { spawn as bunSpawn } from "bun";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FeedEvent, IterationUsage } from "@ralphy/types";
import { parseClaudeLine } from "./claude-stream";

export { parseClaudeLine, type ClaudeStreamState } from "./claude-stream";

export type ClaudeSpawnFn = typeof bunSpawn;

export interface RunClaudeOptions {
  model: string;
  prompt: string;
  resumeSessionId?: string;
  cwd?: string;
  logFile?: string;
  signal?: AbortSignal;
  onEvent: (event: FeedEvent) => void;
  /** Spawn function; injected so callers can substitute for tests. */
  spawn?: ClaudeSpawnFn;
}

export interface ClaudeResult {
  exitCode: number;
  usage: IterationUsage | null;
  /** Claude session ID, captured from the stream-json init event. */
  sessionId: string | null;
  /** True when the engine emitted text matching a known rate-limit pattern. */
  rateLimited: boolean;
}

export function buildClaudeArgs(model: string, resumeSessionId?: string): string[] {
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

const RATE_LIMIT_PATTERNS = [/you've hit your limit/i, /rate limit/i, /too many requests/i];

export function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
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

/**
 * Spawn the Claude CLI, pipe the prompt via stdin, and stream stdout
 * through the stream-json parser, emitting structured FeedEvents.
 */
export async function runClaude(opts: RunClaudeOptions): Promise<ClaudeResult> {
  const spawn = opts.spawn ?? bunSpawn;

  const proc = spawn({
    cmd: ["claude", ...buildClaudeArgs(opts.model, opts.resumeSessionId)],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });

  // Track whether *we* killed the process. A SIGTERM/SIGKILL exit only
  // normalizes to success when *we* asked for it — never because the OS
  // or some external signal handler killed the process.
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

  let rawWriter: WriteStream | null = null;
  if (opts.logFile) {
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
  let sessionId: string | null = null;
  let detectedRateLimit = false;
  const state = {
    turnCount: 0,
    toolCount: 0,
    gotResult: false,
    usage: null as IterationUsage | null,
  };

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
    for (const event of parseClaudeLine(line, state)) {
      if (event.type === "text" && isRateLimitText(event.text)) {
        detectedRateLimit = true;
      }
      opts.onEvent(event);
    }
    // Kill the process after the first result event — the agent is done.
    // Without this, the CLI keeps the session alive and the agent wastes
    // tokens responding to system reminders with idle "standing by" messages.
    if (state.gotResult) {
      killProc();
      break;
    }
  }

  await closeRaw();

  const exitCode = await proc.exited;
  const wasIntentionalKill = intentionalKill && (exitCode === 143 || exitCode === 137);
  const normalizedExitCode = wasIntentionalKill ? 0 : exitCode;

  return {
    exitCode: normalizedExitCode,
    usage: state.usage,
    sessionId,
    rateLimited: detectedRateLimit,
  };
}
