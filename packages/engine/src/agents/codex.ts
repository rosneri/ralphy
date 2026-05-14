import { spawn } from "../spawn";
import { parseCodexLine } from "../formatters/codex-stream";
import { streamLines } from "./stream";
import type { Agent, AgentRequest, AgentRunResult } from "./protocol";

function buildCodexArgs(): string[] {
  return ["exec", "--json", "--color", "never", "--dangerously-bypass-approvals-and-sandbox", "-"];
}

export const codexAgent: Agent = {
  name: "codex",

  async run(req: AgentRequest): Promise<AgentRunResult> {
    const proc = spawn({
      cmd: ["codex", ...buildCodexArgs()],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      ...(req.cwd ? { cwd: req.cwd } : {}),
    });

    let intentionalKill = false;
    const killProc = (): void => {
      intentionalKill = true;
      proc.kill();
    };

    if (req.signal) {
      if (req.signal.aborted) {
        killProc();
      } else {
        req.signal.addEventListener("abort", killProc, { once: true });
      }
    }

    const stdin = proc.stdin as import("bun").FileSink;
    stdin.write(new TextEncoder().encode(req.prompt));
    await stdin.flush();
    stdin.end();

    const codexState = {
      printingText: false,
      rateLimited: false,
      pendingTools: 0,
    };

    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    for await (const line of streamLines(stdout)) {
      req.onRawLine?.(line);
      for (const event of parseCodexLine(line, codexState)) {
        req.onFeedEvent(event);
      }
    }

    if (proc.stderr) {
      const stderr = proc.stderr as ReadableStream<Uint8Array>;
      for await (const line of streamLines(stderr)) {
        req.onRawLine?.(line);
        for (const event of parseCodexLine(line, codexState)) {
          req.onFeedEvent(event);
        }
      }
    }

    const rawExitCode = await proc.exited;
    const wasIntentionalKill = intentionalKill && (rawExitCode === 143 || rawExitCode === 137);
    const exitCode = wasIntentionalKill ? 0 : rawExitCode;

    return {
      exitCode,
      usage: null,
      sessionId: null,
      rateLimited: codexState.rateLimited,
    };
  },
};
