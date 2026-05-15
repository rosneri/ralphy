import type { PrStatus } from "./agent/pr-status";

export type Tier = 1 | 2 | 3 | 4 | 5;

/**
 * Tier assignment per the RLF-13 prioritization rules:
 *   1: conflict + auto-merge   (PR can never merge, blocks the queue)
 *   2: failing CI + auto-merge (auto-merge will never fire)
 *   3: conflict (any)
 *   4: failing CI (any)
 *   5: everything else (including no-PR rows, draft, pending, pass, errored gh)
 */
export function assignTier(status: PrStatus | null): Tier {
  if (status === null || status.kind === "error") return 5;
  const conflict = status.mergeable === "CONFLICTING";
  const failing = status.ciBucket === "fail";
  if (conflict && status.autoMergeEnabled) return 1;
  if (failing && status.autoMergeEnabled) return 2;
  if (conflict) return 3;
  if (failing) return 4;
  return 5;
}

export interface SortableRow {
  identifier: string;
  status: PrStatus | null;
  /** Linear-bucket fallback order — used to keep no-PR rows stable. */
  bucketOrder: number;
}

function createdAtOf(status: PrStatus | null): string {
  if (status && status.kind === "ok") return status.createdAt;
  return "";
}

/**
 * Sort by (tier asc, createdAt asc, bucketOrder asc, identifier asc).
 * `createdAt` is empty string for no-PR / errored rows; empty string sorts
 * before any ISO timestamp, which is fine because those all live in tier 5
 * and the secondary `bucketOrder` keeps them in the original Linear order.
 */
export function sortRows<R extends SortableRow>(rows: R[]): R[] {
  return [...rows].sort((a, b) => {
    const ta = assignTier(a.status);
    const tb = assignTier(b.status);
    if (ta !== tb) return ta - tb;
    const ca = createdAtOf(a.status);
    const cb = createdAtOf(b.status);
    if (ca !== cb) return ca < cb ? -1 : 1;
    if (a.bucketOrder !== b.bucketOrder) return a.bucketOrder - b.bucketOrder;
    return a.identifier.localeCompare(b.identifier);
  });
}
