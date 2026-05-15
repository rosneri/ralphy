import type { PrStatus } from "./pr-status";

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
  /** ISO-8601 createdAt from Linear — FIFO key within a tier. Empty when unknown. */
  issueCreatedAt: string;
}

function createdAtOf(status: PrStatus | null): string {
  if (status && status.kind === "ok") return status.createdAt;
  return "";
}

/**
 * Sort by (tier asc, issueCreatedAt asc, prCreatedAt asc, bucketOrder asc, identifier asc).
 * `issueCreatedAt` is the Linear issue's createdAt — FIFO within a tier, so
 * older work drains first (RLF-36). The PR createdAt remains as a deeper
 * tiebreaker for legacy cases. Empty strings sort before any ISO timestamp;
 * `bucketOrder` keeps no-PR/no-createdAt rows in their original Linear order.
 */
export function sortRows<R extends SortableRow>(rows: R[]): R[] {
  return [...rows].sort((a, b) => {
    const ta = assignTier(a.status);
    const tb = assignTier(b.status);
    if (ta !== tb) return ta - tb;
    const ia = a.issueCreatedAt;
    const ib = b.issueCreatedAt;
    if (ia !== ib) {
      if (ia === "") return 1;
      if (ib === "") return -1;
      return ia < ib ? -1 : 1;
    }
    const ca = createdAtOf(a.status);
    const cb = createdAtOf(b.status);
    if (ca !== cb) return ca < cb ? -1 : 1;
    if (a.bucketOrder !== b.bucketOrder) return a.bucketOrder - b.bucketOrder;
    return a.identifier.localeCompare(b.identifier);
  });
}
