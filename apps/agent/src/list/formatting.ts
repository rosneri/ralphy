import type { GetIndicator, Indicators, Marker } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";
import { unionMarkers } from "../agent/wire/indicators";
import { orderIssuesHierarchically } from "@ralphy/core/ordering";
import { linearIssueToOrderable } from "../queue/queue-order";
import type { PrStatus } from "../pr-status";

export interface Bucket {
  label: string;
  indicator: GetIndicator | undefined;
  exclude: Marker[];
}

export function buildBuckets(indicators: Indicators): Bucket[] {
  const excludeFromTodo = unionMarkers(indicators.setDone, indicators.setError);
  const excludeFromInProgress = unionMarkers(indicators.setError);
  return [
    { label: "todo", indicator: indicators.getTodo, exclude: excludeFromTodo },
    { label: "in-progress", indicator: indicators.getInProgress, exclude: excludeFromInProgress },
    { label: "auto-merge", indicator: indicators.getAutoMerge, exclude: [] },
  ];
}

/** Render the Unresolved column cell for a row. */
export function formatReviewCell(prUrl: string | null, count: number | undefined): string {
  if (!prUrl) return "-";
  return count !== undefined ? String(count) : "-";
}

/** Render the Blocked column cell for a row. */
export function formatBlockedCell(blockedByIdentifiers: string[]): string {
  return blockedByIdentifiers.length === 0 ? "-" : blockedByIdentifiers.join(", ");
}

/** Returns the index of the first row with no blockers, or -1 if all are blocked. */
export function selectNextPickIndex(rows: { blockedByIdentifiers: string[] }[]): number {
  return rows.findIndex((r) => r.blockedByIdentifiers.length === 0);
}

/** Render the PR status as a short marker for the unified list table. */
export function formatPrStatusMarker(status: PrStatus | null, failedCheckNames?: string[]): string {
  if (status === null) return "(no PR)";
  if (status.kind === "error") return "?";
  if (status.state === "MERGED") return "merged";
  if (status.state === "CLOSED") return "closed";
  const parts: string[] = [];
  if (status.mergeable === "CONFLICTING") parts.push("✗conflict");
  if (status.ciBucket === "fail") {
    if (failedCheckNames && failedCheckNames.length > 0) {
      parts.push(`✗ci[${failedCheckNames.join(", ")}]`);
    } else {
      parts.push("✗ci");
    }
  }
  if (status.ciBucket === "pending") parts.push("⏳ci");
  if (status.isDraft) parts.push("draft");
  if (status.autoMergeEnabled) parts.push("auto-merge");
  if (parts.length === 0) return "ok";
  return parts.join(" ");
}

/**
 * Compute the hierarchical backlog rank (project → milestone → item) for a set
 * of issues, keyed by issue id. `agent list` uses this as each row's
 * `bucketOrder` so the rendered order matches the agent queue's pickup order
 * for the same input. Pure (no IO); exported for consistency tests.
 */
export function backlogRankByIssueId(issues: TrackedIssue[]): Map<string, number> {
  const ordered = orderIssuesHierarchically(issues.map((issue) => linearIssueToOrderable(issue)));
  const rankById = new Map<string, number>();
  ordered.forEach((o, i) => rankById.set(o.id, i));
  return rankById;
}
