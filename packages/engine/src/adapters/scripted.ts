import type { IterationUsage } from "@ralphy/types";
import type { FeedEvent } from "../feed-events";
import type { EngineAdapter } from "../adapter";

export interface ScriptedAdapterOptions {
  /** Canned event sequence to yield. */
  events: FeedEvent[];
  /** Exit code resolved by `adapter.exited`. Defaults to 0. */
  exitCode?: number;
  /** Captured session id (full, not truncated). */
  sessionId?: string;
  /** Final usage stats to report. */
  usage?: IterationUsage;
  /** Delay between events in ms. Lets tests exercise abort-during-stream. */
  eventDelayMs?: number;
  /**
   * Override the exit code returned after kill() is called. Used to simulate
   * SIGTERM-style exits (143) so the consumer's normalization logic can be tested.
   */
  killedExitCode?: number;
}

interface ScriptedAdapter extends EngineAdapter {
  /** Test-only introspection: number of events the consumer pulled before stopping. */
  eventsConsumed(): number;
  /** Test-only: did kill() get called? */
  wasKilled(): boolean;
}

/**
 * Create a scripted EngineAdapter that emits a canned FeedEvent sequence.
 *
 * Lets engine-level tests exercise session capture, usage aggregation,
 * rate-limit handling, abort/cancel, and exit-code paths without spawning
 * a subprocess or mocking `Bun.spawn`.
 */
export function createScriptedAdapter(opts: ScriptedAdapterOptions): ScriptedAdapter {
  const { events, sessionId = null, usage = null } = opts;
  const defaultExit = opts.exitCode ?? 0;

  let killed = false;
  let intentional = false;
  let consumed = 0;

  let resolveExit: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  // If no kill() ever happens, resolve at the end of the event stream.
  function finishStreamNaturally(): void {
    if (!killed) resolveExit(defaultExit);
  }

  async function* eventStream(): AsyncIterable<FeedEvent> {
    for (const event of events) {
      if (killed) break;
      if (opts.eventDelayMs && opts.eventDelayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.eventDelayMs));
      }
      if (killed) break;
      consumed++;
      yield event;
    }
    finishStreamNaturally();
  }

  return {
    events: eventStream,
    getSessionId: () => sessionId,
    getUsage: () => usage,
    exited,
    kill: () => {
      if (killed) return;
      killed = true;
      intentional = true;
      const code = opts.killedExitCode ?? defaultExit;
      resolveExit(code);
    },
    intentionalKill: () => intentional,
    eventsConsumed: () => consumed,
    wasKilled: () => killed,
  };
}
