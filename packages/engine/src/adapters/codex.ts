import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "../spawn";
import type { FeedEvent } from "../feed-events";
import { parseCodexLine } from "../formatters/codex-stream";
import type { EngineAdapter } from "../adapter";
import { streamLines } from "./stream-lines";

export interface CodexAdapterOptions {
  prompt: string;
  cwd?: string;
  logFile?: string;
  logFlag?: boolean;
}

function buildCodexArgs(): string[] {
  return ["exec", "--json", "--color", "never", "--dangerously-bypass-approvals-and-sandbox", "-"];
}

/**
 * Build an EngineAdapter that spawns the Codex CLI and yields parsed
 * FeedEvents from its stream-JSON stdout and stderr.
 */
export function createCodexAdapter(opts: CodexAdapterOptions): EngineAdapter {
  const cmd = ["codex", ...buildCodexArgs()];
  const proc = spawn({
    cmd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
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

  const state = {
    printingText: false,
    rateLimited: false,
    pendingTools: 0,
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
        for (const event of parseCodexLine(line, state)) {
          yield event;
        }
      }
      if (proc.stderr) {
        const stderr = proc.stderr as ReadableStream<Uint8Array>;
        for await (const line of streamLines(stderr)) {
          writeRaw(line);
          for (const event of parseCodexLine(line, state)) {
            yield event;
          }
        }
      }
    } finally {
      await closeRaw();
    }
  }

  return {
    events,
    getSessionId: () => null,
    getUsage: () => null,
    exited: proc.exited,
    kill,
    intentionalKill: () => intentional,
  };
}
