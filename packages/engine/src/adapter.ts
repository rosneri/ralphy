import { type Engine, type IterationUsage } from "@ralphy/types";
import { type FeedEvent, renderFeedEvent } from "./feed-events";

/**
 * Source of pre-parsed feed events for the engine to consume.
 *
 * Production adapters wrap a spawned subprocess and parse its stream-JSON
 * stdout into feed events. The scripted adapter (see `adapters/scripted.ts`)
 * emits a canned sequence for tests, so engine-level behavior can be
 * exercised without mocking `Bun.spawn` / `Bun.spawnSync`.
 */
export interface EngineAdapter {
  events(): AsyncIterable<FeedEvent>;
  /** Captured session id (Claude). Returns the full id, not the truncated 8-char display value. */
  getSessionId(): string | null;
  /** Aggregated usage stats (Claude). Null for codex / scripted-without-usage. */
  getUsage(): IterationUsage | null;
  /** Resolves with the underlying process exit code (0 for scripted by default). */
  exited: Promise<number>;
  /** Stop the underlying process. Idempotent. */
  kill(): void;
  /** True once this adapter's kill() was invoked by us — used to normalize signal exits. */
  intentionalKill(): boolean;
}

export interface ConsumeOptions {
  engine: Engine;
  onFeedEvent?: (event: FeedEvent) => void;
  onOutput?: (line: string) => void;
  signal?: AbortSignal;
}

export interface ConsumeResult {
  exitCode: number;
  usage: IterationUsage | null;
  sessionId: string | null;
  rateLimited: boolean;
}

const RATE_LIMIT_PATTERNS = [/you've hit your limit/i, /rate limit/i, /too many requests/i];

function isRateLimitText(text: string): boolean {
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/**
 * Consume the event stream from an adapter, surfacing each event to the
 * caller and aggregating session/usage/rate-limit/exit state.
 *
 * For the claude engine, the adapter is killed as soon as a `result` or
 * `result-error` event is observed (matching the existing runEngine
 * behavior — without this, claude keeps the session alive and wastes
 * tokens replying to system reminders).
 */
export async function consumeEngineEvents(
  adapter: EngineAdapter,
  opts: ConsumeOptions,
): Promise<ConsumeResult> {
  const emit = opts.onFeedEvent;
  const write = opts.onOutput ?? ((l: string) => process.stdout.write(l + "\n"));
  function emitEvent(event: FeedEvent): void {
    if (emit) {
      emit(event);
    } else {
      for (const l of renderFeedEvent(event)) write(l);
    }
  }

  let aborted = false;
  let abortHandler: (() => void) | undefined;
  if (opts.signal) {
    abortHandler = () => {
      aborted = true;
      adapter.kill();
    };
    if (opts.signal.aborted) {
      abortHandler();
    } else {
      opts.signal.addEventListener("abort", abortHandler, { once: true });
    }
  }

  let detectedRateLimit = false;
  try {
    for await (const event of adapter.events()) {
      if (event.type === "text" && isRateLimitText(event.text)) {
        detectedRateLimit = true;
      }
      emitEvent(event);
      if (opts.engine === "claude" && (event.type === "result" || event.type === "result-error")) {
        adapter.kill();
        break;
      }
    }
  } finally {
    if (opts.signal && abortHandler) {
      opts.signal.removeEventListener("abort", abortHandler);
    }
  }

  const exitCode = await adapter.exited;
  const wasIntentionalKill = adapter.intentionalKill() && (exitCode === 143 || exitCode === 137);
  const normalizedExitCode = wasIntentionalKill ? 0 : exitCode;

  void aborted; // surfaced via opts.signal; retained for future telemetry

  return {
    exitCode: normalizedExitCode,
    usage: adapter.getUsage(),
    sessionId: adapter.getSessionId(),
    rateLimited: detectedRateLimit,
  };
}
