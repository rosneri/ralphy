import type { Engine, IterationUsage } from "@ralphy/types";
import type { FeedEvent } from "../feed-events";
import type { Agent, AgentRequest, AgentRunResult } from "./protocol";

import { isRateLimitText, isResultErrorLimitText } from "./rate-limit-detection";

export interface ScriptedAgentOptions {
  /** Engine name this scripted agent impersonates. Controls result-based
   *  early-stop behavior (claude stops at the first result event; codex
   *  consumes the full stream). Defaults to "claude". */
  engine?: Engine;
  /** Canned event sequence to yield. */
  events: FeedEvent[];
  /** Exit code returned when the scripted run finishes normally. Defaults to 0. */
  exitCode?: number;
  /** Captured session id. */
  sessionId?: string;
  /** Final usage stats to report. */
  usage?: IterationUsage;
  /** Delay between events in ms — lets tests exercise abort-during-stream. */
  eventDelayMs?: number;
  /** Override the exit code returned after an intentional kill (signal abort
   *  or claude's stop-at-result). Used to simulate SIGTERM-style exits (143/137)
   *  so the consumer's normalization logic can be tested. */
  killedExitCode?: number;
}

export interface ScriptedAgent extends Agent {
  /** Test-only introspection. */
  wasKilled(): boolean;
}

/**
 * Build an in-memory Agent that emits a canned FeedEvent sequence.
 *
 * Lets engine-level tests exercise session capture, usage aggregation,
 * rate-limit handling, abort/cancel, and exit-code paths without spawning
 * a subprocess or mocking `Bun.spawn`.
 */
export function createScriptedAgent(opts: ScriptedAgentOptions): ScriptedAgent {
  const engine: Engine = opts.engine ?? "claude";
  const defaultExit = opts.exitCode ?? 0;

  let killed = false;

  return {
    name: engine,

    async run(req: AgentRequest): Promise<AgentRunResult> {
      let intentionalKill = false;
      const kill = (): void => {
        if (killed) return;
        killed = true;
        intentionalKill = true;
      };

      if (req.signal) {
        if (req.signal.aborted) {
          kill();
        } else {
          req.signal.addEventListener("abort", kill, { once: true });
        }
      }

      let detectedRateLimit = false;
      let stopped = false;

      for (const event of opts.events) {
        if (killed) break;
        if (opts.eventDelayMs && opts.eventDelayMs > 0) {
          await new Promise((r) => setTimeout(r, opts.eventDelayMs));
        }
        if (killed) break;

        if (event.type === "text" && isRateLimitText(event.text)) {
          detectedRateLimit = true;
        }
        if (event.type === "result-error" && isResultErrorLimitText(event.message)) {
          detectedRateLimit = true;
        }
        req.onFeedEvent(event);

        if (engine === "claude" && (event.type === "result" || event.type === "result-error")) {
          kill();
          stopped = true;
          break;
        }
      }

      void stopped;

      const rawExit = killed ? (opts.killedExitCode ?? defaultExit) : defaultExit;
      const wasIntentionalKill = intentionalKill && (rawExit === 143 || rawExit === 137);
      const exitCode = wasIntentionalKill ? 0 : rawExit;

      return {
        exitCode,
        usage: opts.usage ?? null,
        sessionId: opts.sessionId ?? null,
        rateLimited: detectedRateLimit,
      };
    },

    wasKilled: () => killed,
  };
}
