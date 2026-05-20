export type PrState = "merged" | "conflicting" | "clean" | "unknown";

export interface PrStateInputs {
  state?: string | null;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
}

/**
 * Classify a PR into one of four detection buckets.
 *
 * Merged PRs route to `clean` (not `conflicting`) so we never spin a
 * conflict-fix on a PR that already merged — see RLF-17 / RLF-25 / RLF-46.
 */
export function detectPrState(inputs: PrStateInputs): PrState {
  const { state, mergeable, mergeStateStatus } = inputs;
  if (state === "MERGED") return "clean";
  if (mergeable === "CONFLICTING") return "conflicting";
  if (mergeStateStatus === "DIRTY") return "conflicting";
  if (mergeable === "MERGEABLE") return "clean";
  if (mergeable === "UNKNOWN" || mergeable == null) return "unknown";
  return "clean";
}
