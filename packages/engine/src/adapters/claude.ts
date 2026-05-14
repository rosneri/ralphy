import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { IterationUsage } from "@ralphy/types";
import { spawn } from "../spawn";
import type { FeedEvent } from "../feed-events";
import { parseClaudeLine } from "../formatters/claude-stream";
import type { EngineAdapter } from "../adapter";
import { streamLines } from "./stream-lines";

export interface ClaudeAdapterOptions {
  model: string;
  prompt: string;
  resumeSessionId?: string;
  cwd?: string;
  logFile?: string;
  logFlag?: boolean;
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
 * Build an EngineAdapter that spawns the Claude CLI and yields parsed
 * FeedEvents from its stream-JSON stdout. Captures the full session id
 * and aggregated usage for the consumer.
 */
export function createClaudeAdapter(opts: ClaudeAdapterOptions): EngineAdapter {
  const cmd = ["claude", ...buildClaudeArgs(opts.model, opts.resumeSessionId)];
  const proc = spawn({
    cmd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });

  let intentional = false;
  const kill = (): void => {
    if (intentional) return;
    intentional = true;
    proc.kill();
  };

  const stdin = proc.stdin as import("bun").FileSink;
  stdin.write(new TextEncoder().encode(opts.prompt));
  void stdin.flush().then(() => stdin.end());

  let sessionId: string | null = null;
  const state = {
    turnCount: 0,
    toolCount: 0,
    gotResult: false,
    usage: null as IterationUsage | null,
  };

  async function* events(): AsyncIterable<FeedEvent> {
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

    try {
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
            // not JSON, ignore
          }
        }
        for (const event of parseClaudeLine(line, state)) {
          yield event;
        }
      }
    } finally {
      await closeRaw();
    }
  }

  return {
    events,
    getSessionId: () => sessionId,
    getUsage: () => state.usage,
    exited: proc.exited,
    kill,
    intentionalKill: () => intentional,
  };
}
