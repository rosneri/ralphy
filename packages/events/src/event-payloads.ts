/**
 * Standalone payload shapes referenced by the `RalphEvent` discriminated
 * union in `./types`. Kept in a sibling module so `types.ts` stays under
 * the repo's per-file line cap; the union itself remains in `./types`.
 */

export interface PollBuckets {
  todo: number;
  inProgress: number;
  conflicted: number;
  review: number;
  mentions: number;
  awaiting: number;
}

export interface PrStatusCounts {
  mergeable: number;
  conflicted: number;
  ciFailed: number;
}

export type FeaturePhase = "detected" | "started" | "completed" | "failed" | "skipped";
