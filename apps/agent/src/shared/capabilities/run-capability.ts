/**
 * Shared shell for executing a `Capability`. Responsibilities, in order:
 *
 *   1. Emit `${cap.name}.started` on the bus.
 *   2. Try `cap.run(args)` up to `cap.retryPolicy.maxAttempts` times.
 *      Between attempts, `cap.retryPolicy.isRetryable(err)` must return
 *      true and we sleep for `cap.retryPolicy.delayMs(attempt, err)`.
 *      No `.failed` event is emitted between retries — only on the
 *      terminal failure.
 *   3. On terminal failure: format the error with
 *      `cap.errorFormatter`, emit `${cap.name}.failed { error }`.
 *      If `cap.required` is true the original error is rethrown and no
 *      value is ever returned (RLF-39 invariant).
 *   4. On success: optionally pass through `cap.adopt`, emit
 *      `${cap.name}.fetched`, and return.
 */

import type { Bus, EmitInput } from "@ralphy/events";
import type { Capability } from "./types";

export interface RunCapabilityCtx {
  bus?: Bus;
}

type StartedEvent = EmitInput & { type: `${string}.started` };
type FetchedEvent = EmitInput & { type: `${string}.fetched`; error?: string };
type FailedEvent = EmitInput & { type: `${string}.failed`; error: string };

function emit(bus: Bus | undefined, ev: EmitInput): void {
  if (!bus) return;
  bus.emit(ev);
}

export async function runCapability<A, R, Raw = R>(
  cap: Capability<A, R, Raw>,
  args: A,
  ctx: RunCapabilityCtx = {},
): Promise<R> {
  const { bus } = ctx;
  emit(bus, { type: `${cap.name}.started` } as StartedEvent);

  let lastError: unknown;
  for (let attempt = 1; attempt <= cap.retryPolicy.maxAttempts; attempt++) {
    try {
      const raw = await cap.run(args);
      const result: R = cap.adopt ? cap.adopt(raw) : (raw as R);
      emit(bus, { type: `${cap.name}.fetched` } as FetchedEvent);
      return result;
    } catch (err) {
      lastError = err;
      const canRetry = attempt < cap.retryPolicy.maxAttempts && cap.retryPolicy.isRetryable(err);
      if (!canRetry) break;
      const delay = Math.max(0, cap.retryPolicy.delayMs(attempt, err));
      if (delay > 0) await sleep(delay);
    }
  }

  const message = cap.errorFormatter(lastError);
  emit(bus, { type: `${cap.name}.failed`, error: message } as FailedEvent);
  if (cap.required) {
    throw lastError;
  }
  // Non-required capabilities also rethrow — the shell exists to
  // standardise telemetry, not to swallow errors. The `required` flag
  // is a hard guarantee that *no other code path* can ever produce a
  // fallback value; non-required failures simply leave that policy to
  // the caller.
  throw lastError;
}

export const runCapabilityInternals = {
  sleep: (ms: number) => sleep(ms),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
