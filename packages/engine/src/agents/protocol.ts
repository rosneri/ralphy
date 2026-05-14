import type { Engine, IterationUsage } from "@ralphy/types";
import type { FeedEvent } from "../feed-events";

/**
 * Symphony-style agent boundary.
 *
 * `AgentRequest` is what the engine sends to an adapter; `FeedEvent`
 * (the existing structured vocabulary) is what flows back out via
 * `onFeedEvent`. Adapters are in-process today but the shape is
 * deliberately serializable so a subprocess transport can be added
 * later without touching `engine.ts`.
 */
export interface AgentRequest {
  model: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
  /** Resume an existing session instead of starting fresh. Claude-only today. */
  resumeSessionId?: string;
  /** Interactive (TTY passthrough) mode. Claude-only today. */
  interactive?: boolean;
  /** Working directory the loop owns for this task. Used by interactive mode
   *  to drop a prompt file. */
  taskDir?: string;
  /** Receive structured events as the agent runs. */
  onFeedEvent: (event: FeedEvent) => void;
  /** Optional hook for raw protocol lines (stdout/stderr from the underlying
   *  CLI). Used by the loop to append raw transcripts to a log file. */
  onRawLine?: (line: string) => void;
}

export interface AgentRunResult {
  exitCode: number;
  usage: IterationUsage | null;
  sessionId: string | null;
  rateLimited: boolean;
}

export interface Agent {
  readonly name: Engine;
  run(req: AgentRequest): Promise<AgentRunResult>;
}
