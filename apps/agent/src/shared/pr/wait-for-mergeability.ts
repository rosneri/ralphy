/**
 * Shared "poll `gh pr view` until mergeability resolves" helper.
 *
 * GitHub computes PR mergeability asynchronously: a fresh PR (or one whose
 * base branch just moved) returns `mergeable: UNKNOWN` until the background
 * test-merge job completes. The two call sites that need to wait for this
 * (PR discovery scan in `wire/pr-discovery.ts`, conflict-fix verify-only
 * short-circuit in `agent/post-task.ts`) had drifted in retry count, backoff,
 * and which fields they consulted; this util keeps them in sync.
 *
 * The fetch path is supplied as `probe` — each caller wires it to whatever
 * `gh pr view` wrapper it already uses (PollContext memoization, raw
 * `fetchPrStatus`, etc.).
 */

interface MergeabilityProbe {
  /** PR state: "OPEN" | "CLOSED" | "MERGED" | undefined. */
  state?: string;
  /** REST `mergeable`: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | undefined. */
  mergeable?: string;
  /**
   * GraphQL `mergeStateStatus`: CLEAN | BLOCKED | BEHIND | DIRTY | DRAFT |
   * HAS_HOOKS | UNSTABLE | UNKNOWN. Often resolves before `mergeable` does.
   */
  mergeStateStatus?: string;
}

type MergeabilityOutcome =
  | { kind: "mergeable" }
  | { kind: "conflicting" }
  | { kind: "closed" } // state flipped to CLOSED/MERGED mid-poll
  | { kind: "unknown" } // exhausted retries with mergeable still UNKNOWN
  | { kind: "error"; message: string }; // probe threw and bailOnError=true

/**
 * Fibonacci-ish backoff. Total wait ≈31s, which covers GitHub's test-merge
 * job for larger diffs (the 6s window the old 3×2s loop used would miss
 * roughly half the >500-LOC PRs we polled in practice).
 */
export const DEFAULT_BACKOFFS_MS = [2000, 3000, 5000, 8000, 13000];

interface WaitForMergeabilityOptions {
  probe: (attempt: number) => Promise<MergeabilityProbe>;
  backoffsMs?: number[];
  /**
   * If true, a thrown `probe` terminates the loop with `kind: "error"`.
   * If false (default), errors are reported to `onError` and the loop
   * continues — matches the historical pr-discovery behavior.
   */
  bailOnError?: boolean;
  onError?: (err: Error, attempt: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

export async function waitForMergeability(
  opts: WaitForMergeabilityOptions,
): Promise<MergeabilityOutcome> {
  const backoffsMs = opts.backoffsMs ?? DEFAULT_BACKOFFS_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const total = backoffsMs.length + 1;

  for (let attempt = 0; attempt < total; attempt++) {
    let probe: MergeabilityProbe | undefined;
    try {
      probe = await opts.probe(attempt);
    } catch (err) {
      const e = err as Error;
      opts.onError?.(e, attempt, total);
      if (opts.bailOnError) {
        return { kind: "error", message: e.message };
      }
    }

    if (probe) {
      const state = probe.state?.toUpperCase();
      if (state && state !== "OPEN") return { kind: "closed" };

      const m = probe.mergeable?.toUpperCase();
      if (m === "MERGEABLE") return { kind: "mergeable" };
      if (m === "CONFLICTING") return { kind: "conflicting" };

      // mergeStateStatus frequently resolves before `mergeable` does.
      // DIRTY = merge conflict; every other settled value means GitHub
      // believes the PR can merge (BLOCKED/UNSTABLE are policy gates,
      // not mergeability problems).
      const mss = probe.mergeStateStatus?.toUpperCase();
      if (mss && mss !== "UNKNOWN") {
        return { kind: mss === "DIRTY" ? "conflicting" : "mergeable" };
      }
    }

    const nextDelay = backoffsMs[attempt];
    if (nextDelay !== undefined) await sleep(nextDelay);
  }

  return { kind: "unknown" };
}
