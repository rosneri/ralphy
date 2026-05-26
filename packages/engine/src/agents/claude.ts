import { mkdtemp, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IterationUsage } from "@ralphy/types";
import { spawn } from "../spawn";
import { scrubClaudeEnv } from "../preflight";
import { parseClaudeLine } from "../formatters/claude-stream";
import { streamLines } from "./stream";
import type { Agent, AgentRequest, AgentRunResult } from "./protocol";

import { isRateLimitText, isResultErrorLimitText } from "./rate-limit-detection";

function buildClaudeArgs(
  model: string,
  resumeSessionId?: string,
  reviewerContextStrategy?: "fresh" | "warm",
  reviewerModel?: string,
): string[] {
  const effectiveModel = reviewerModel ?? model;
  const args = [
    "-p",
    "-",
    "--dangerously-skip-permissions",
    "--model",
    effectiveModel,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (resumeSessionId && reviewerContextStrategy !== "fresh") {
    args.push("--resume", resumeSessionId);
  }
  return args;
}

async function runInteractive(req: AgentRequest): Promise<AgentRunResult> {
  const { model, prompt, taskDir } = req;
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
      env: scrubClaudeEnv(process.env as Record<string, string | undefined>),
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

export const claudeAgent: Agent = {
  name: "claude",

  async run(req: AgentRequest): Promise<AgentRunResult> {
    if (req.interactive) {
      return runInteractive(req);
    }

    const proc = spawn({
      cmd: [
        "claude",
        ...buildClaudeArgs(
          req.model,
          req.resumeSessionId,
          req.reviewerContextStrategy,
          req.reviewerModel,
        ),
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
      env: scrubClaudeEnv(process.env as Record<string, string | undefined>),
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

    const claudeState = {
      turnCount: 0,
      toolCount: 0,
      gotResult: false,
      usage: null as IterationUsage | null,
    };

    let sessionId: string | null = null;
    let detectedRateLimit = false;

    const stdout = proc.stdout as ReadableStream<Uint8Array>;
    const parseOptions =
      process.stdout.isTTY && process.stdout.columns
        ? { maxWidth: process.stdout.columns }
        : undefined;
    for await (const line of streamLines(stdout)) {
      req.onRawLine?.(line);

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

      for (const event of parseClaudeLine(line, claudeState, parseOptions)) {
        if (event.type === "text" && isRateLimitText(event.text)) {
          detectedRateLimit = true;
        }
        if (event.type === "result-error" && isResultErrorLimitText(event.message)) {
          detectedRateLimit = true;
        }
        req.onFeedEvent(event);
      }

      // Kill the process after the first result event — the agent is done.
      // Without this, the CLI keeps the session alive and the agent wastes
      // tokens responding to system reminders with idle "standing by" messages.
      if (claudeState.gotResult) {
        killProc();
        break;
      }
    }

    const rawExitCode = await proc.exited;
    const wasIntentionalKill = intentionalKill && (rawExitCode === 143 || rawExitCode === 137);
    const exitCode = wasIntentionalKill ? 0 : rawExitCode;

    return {
      exitCode,
      usage: claudeState.usage,
      sessionId,
      rateLimited: detectedRateLimit,
    };
  },
};
