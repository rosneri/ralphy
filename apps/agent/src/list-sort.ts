import type { PrStatus } from "./pr-status";
import { chain } from "./sort/compare";

type Tier = 1 | 2 | 3 | 4 | 5;

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
  const cmp = chain<R>(
    (a, b) => assignTier(a.status) - assignTier(b.status),
    (a, b) => {
      const ca = createdAtOf(a.status);
      const cb = createdAtOf(b.status);
      if (ca === cb) return 0;
      return ca < cb ? -1 : 1;
    },
    (a, b) => a.bucketOrder - b.bucketOrder,
    (a, b) => a.identifier.localeCompare(b.identifier),
  );
  return [...rows].sort(cmp);
}
