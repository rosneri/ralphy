import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { type Engine, type IterationUsage } from "@ralphy/types";
import { type FeedEvent, renderFeedEvent } from "./feed-events";
import { getAgent } from "./agents";
import type { Agent, AgentRequest } from "./agents";

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
   * Inject a pre-built Agent (e.g. the scripted agent) instead of looking one
   * up by `engine`. Production callers should leave this unset; tests use it
   * to exercise engine-level behavior without a subprocess.
   */
  agent?: Agent;
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

/**
 * Drive an agent through the App-Server Protocol boundary.
 *
 * `runEngine` is now a thin dispatcher: it picks the registered adapter
 * for `opts.engine` (or uses an injected `opts.agent`), wires up callbacks
 * (raw-line logging, string-fallback rendering), and forwards the request.
 * All agent-specific wire-format knowledge lives in `agents/<name>.ts`.
 */
export async function runEngine(opts: RunEngineOptions): Promise<EngineResult> {
  const agent = opts.agent ?? getAgent(opts.engine);
  const write = opts.onOutput ?? ((l: string) => process.stdout.write(l + "\n"));

  let rawWriter: WriteStream | null = null;
  if (opts.logFlag && opts.logFile) {
    await mkdir(dirname(opts.logFile), { recursive: true });
    rawWriter = createWriteStream(opts.logFile, { flags: "a" });
  }
  const closeRaw = () =>
    new Promise<void>((resolve) => {
      if (!rawWriter) return resolve();
      rawWriter.end(resolve);
    });

  const userOnFeedEvent = opts.onFeedEvent;
  const onFeedEvent = (event: FeedEvent): void => {
    if (userOnFeedEvent) {
      userOnFeedEvent(event);
    } else {
      for (const l of renderFeedEvent(event)) {
        write(l);
      }
    }
  };

  const request: AgentRequest = {
    model: opts.model,
    prompt: opts.prompt,
    onFeedEvent,
  };
  if (opts.cwd !== undefined) request.cwd = opts.cwd;
  if (opts.signal !== undefined) request.signal = opts.signal;
  if (opts.resumeSessionId !== undefined) request.resumeSessionId = opts.resumeSessionId;
  if (opts.interactive !== undefined) request.interactive = opts.interactive;
  if (opts.taskDir !== undefined) request.taskDir = opts.taskDir;
  if (rawWriter) {
    request.onRawLine = (line: string) => {
      rawWriter!.write(line + "\n");
    };
  }

  try {
    const result = await agent.run(request);
    return result;
  } finally {
    await closeRaw();
  }
}
