import type { FeedEvent, IterationUsage } from "@ralphy/types";
import { parseCodexLine, type CodexStreamState } from "./codex-stream";
import { spawn } from "./spawn";

export { parseCodexLine } from "./codex-stream";
export type { CodexStreamState } from "./codex-stream";

export interface AgentAdapterOptions {
  model: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  resumeSessionId?: string;
  onFeedEvent: (event: FeedEvent) => void;
  onRawLine?: (line: string) => void;
}

export interface AgentAdapterResult {
  exitCode: number;
  usage: IterationUsage | null;
  sessionId: string | null;
  rateLimited: boolean;
}

export type AgentAdapter = (opts: AgentAdapterOptions) => Promise<AgentAdapterResult>;

export function buildCodexArgs(): string[] {
  return ["exec", "--json", "--color", "never", "--dangerously-bypass-approvals-and-sandbox", "-"];
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

export const createCodexAdapter: AgentAdapter = async (opts) => {
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

  const stdin = proc.stdin as import("bun").FileSink;
  stdin.write(new TextEncoder().encode(opts.prompt));
  await stdin.flush();
  stdin.end();

  const writeRaw = (line: string) => {
    if (opts.onRawLine) opts.onRawLine(line);
  };

  const state: CodexStreamState = {
    printingText: false,
    rateLimited: false,
    pendingTools: 0,
  };

  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  for await (const line of streamLines(stdout)) {
    writeRaw(line);
    for (const event of parseCodexLine(line, state)) {
      opts.onFeedEvent(event);
    }
  }

  if (proc.stderr) {
    const stderr = proc.stderr as ReadableStream<Uint8Array>;
    for await (const line of streamLines(stderr)) {
      writeRaw(line);
      for (const event of parseCodexLine(line, state)) {
        opts.onFeedEvent(event);
      }
    }
  }

  const exitCode = await proc.exited;
  const wasIntentionalKill = intentionalKill && (exitCode === 143 || exitCode === 137);
  const normalizedExitCode = wasIntentionalKill ? 0 : exitCode;

  return {
    exitCode: normalizedExitCode,
    usage: null,
    sessionId: null,
    rateLimited: state.rateLimited,
  };
};
