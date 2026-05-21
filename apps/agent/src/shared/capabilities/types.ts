/**
 * Capability descriptor and supporting types for the shared capability
 * shell. Every external side-effect (Linear, gh, git, fs writes, worker
 * spawn) is expressed as a `Capability` and executed through
 * `runCapability` so retry / error formatting / bus telemetry are
 * uniform across surfaces.
 */

export interface RetryPolicy {
  /** Total attempts including the first try. Must be >= 1. */
  maxAttempts: number;
  isRetryable: (err: unknown) => boolean;
  /** Delay before the *next* attempt. `attempt` is 1-based for the
   *  attempt that just failed. */
  delayMs: (attempt: number, err: unknown) => number;
}

export type ErrorFormatter = (err: unknown) => string;

export interface Capability<TArgs, TResult> {
  /** Stable identifier used as the bus event prefix, e.g.
   *  "linear.tickets.fetch". */
  name: string;
  /** If true, a thrown error after exhausted retries is rethrown and no
   *  fallback value is ever produced. This enforces the RLF-39
   *  invariant at the shell level. */
  required: boolean;
  retryPolicy: RetryPolicy;
  errorFormatter: ErrorFormatter;
  /** Optional shape-narrowing adapter applied to a successful result. */
  adopt?: (raw: unknown) => TResult;
  run: (args: TArgs) => Promise<TResult>;
}

export const NO_RETRY: RetryPolicy = {
  maxAttempts: 1,
  isRetryable: () => false,
  delayMs: () => 0,
};
