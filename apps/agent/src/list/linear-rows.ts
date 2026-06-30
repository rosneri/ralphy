import type { LinearFilterScope } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";
import { type LinearFilterSpec } from "../shared/capabilities/linear-client/filters";
import { fetchOpenIssues } from "../shared/capabilities/linear-client/issues";
import { fetchAttachmentsForIssues } from "../shared/capabilities/linear-client/attachments";
import { fetchPrStatus } from "../pr-status";
import { createGhCliCodeHost } from "@ralphy/codehost";
import type { CmdRunner } from "../agent/pr";
import { discoverPrUrlFromGitHub } from "../agent/pr-url";
import { sortRows, type SortableRow } from "../list-sort";
import { getPrChecksStatus } from "../agent/ci";
import { fetchPrReviewSummary } from "../shared/pr/review-state";
import {
  backlogRankByIssueId,
  formatBlockedCell,
  formatPrStatusMarker,
  formatReviewCell,
  selectNextPickIndex,
  type Bucket,
} from "./formatting";
import { findPullRequestUrl, pad } from "./local-rows";

export async function fetchBucketIssues(
  apiKey: string,
  bucket: Bucket,
  team: string | undefined,
  assignee: string | undefined,
  anyAssignee: boolean | undefined,
  scope: LinearFilterScope,
  ticketNumbers: number[],
): Promise<TrackedIssue[]> {
  if (!bucket.indicator || bucket.indicator.filter.length === 0) return [];
  const spec: LinearFilterSpec = {
    team,
    assignee,
    anyAssignee,
    ...scope,
    include: bucket.indicator.filter,
    exclude: bucket.exclude,
    ...(ticketNumbers.length > 0 ? { numbers: ticketNumbers } : {}),
  };
  return fetchOpenIssues(apiKey, spec);
}

interface UnifiedRow extends SortableRow {
  issueId: string;
  bucketLabel: string;
  stateName: string;
  title: string;
  prUrl: string | null;
  blockedByIdentifiers: string[];
  failedCheckNames?: string[];
  review?: number;
}

export async function fetchAndPrintLinear(
  apiKey: string,
  buckets: Bucket[],
  team: string | undefined,
  assignee: string | undefined,
  anyAssignee: boolean | undefined,
  scope: LinearFilterScope,
  cwd: string,
  runner: CmdRunner,
  ignoreCiChecks: string[] = [],
  checks = false,
  review = false,
  ticketNumbers: number[] = [],
): Promise<void> {
  // Fan out across buckets in parallel.
  const bucketResults = await Promise.all(
    buckets.map(async (bucket) => {
      if (!bucket.indicator || bucket.indicator.filter.length === 0) {
        return { bucket, issues: [] as TrackedIssue[], error: null as string | null };
      }
      try {
        const issues = await fetchBucketIssues(
          apiKey,
          bucket,
          team,
          assignee,
          anyAssignee,
          scope,
          ticketNumbers,
        );
        return { bucket, issues, error: null };
      } catch (err) {
        return {
          bucket,
          issues: [] as TrackedIssue[],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  for (const { bucket, error } of bucketResults) {
    if (error) {
      process.stdout.write(`\n${bucket.label}: error fetching from Linear — ${error}\n`);
    }
  }

  // Dedupe by issue id, remembering bucket label and the source issue (the
  // first bucket wins, as before).
  const seen = new Map<string, UnifiedRow>();
  const issueById = new Map<string, TrackedIssue>();
  for (const { bucket, issues } of bucketResults) {
    for (const issue of issues) {
      if (seen.has(issue.id)) continue;
      issueById.set(issue.id, issue);
      seen.set(issue.id, {
        issueId: issue.id,
        identifier: issue.identifier,
        status: null,
        // Filled in below from the hierarchical backlog order so the list
        // matches the queue's pickup order for the same input.
        bucketOrder: 0,
        issueCreatedAt: issue.createdAt,
        bucketLabel: bucket.label,
        stateName: issue.state.name,
        title: issue.title.slice(0, 60),
        prUrl: null,
        blockedByIdentifiers: issue.blockedByIdentifiers ?? [],
      });
    }
  }
  const rows = [...seen.values()];

  // Order issues hierarchically (project → milestone → item) and use that rank
  // as each row's bucketOrder, so `agent list` and the agent queue agree on
  // ordering for the same input.
  const rankById = backlogRankByIssueId([...issueById.values()]);
  for (const row of rows) row.bucketOrder = rankById.get(row.issueId) ?? 0;

  // Resolve PR URLs via a single bulk attachments query (one Linear request
  // for every row, instead of N parallel calls). Falls back to a per-row
  // GitHub search when Linear has no attachment for an identifier yet.
  try {
    const attachmentsByIssue = await fetchAttachmentsForIssues(
      apiKey,
      rows.map((r) => r.issueId),
    );
    for (const row of rows) {
      const attachments = attachmentsByIssue.get(row.issueId) ?? [];
      row.prUrl = findPullRequestUrl(attachments);
    }
  } catch {
    // leave prUrl null on bulk attachment fetch failure
  }
  await Promise.all(
    rows.map(async (row) => {
      if (row.prUrl) return;
      try {
        const fromGitHub = await discoverPrUrlFromGitHub(row.identifier, runner, cwd);
        if (fromGitHub) row.prUrl = fromGitHub;
      } catch {
        // leave prUrl null on GitHub fallback failure
      }
    }),
  );

  // Resolve PR status in parallel.
  await Promise.all(
    rows.map(async (row) => {
      if (!row.prUrl) return;
      row.status = await fetchPrStatus(row.prUrl, runner, cwd, undefined, ignoreCiChecks);
    }),
  );

  if (checks) {
    // Build the gh adapter once for the whole list run (RLF-255 9a) — the
    // per-row CI probe routes through this single instance instead of
    // re-constructing one per row.
    const codeHost = createGhCliCodeHost({ cmdRunner: runner, cwd, ignoreChecks: ignoreCiChecks });
    await Promise.all(
      rows.map(async (row) => {
        if (!row.prUrl || row.status?.kind !== "ok" || row.status.ciBucket !== "fail") return;
        try {
          const ciStatus = await getPrChecksStatus(row.prUrl, codeHost);
          row.failedCheckNames = ciStatus.failedCheckNames;
        } catch {
          row.failedCheckNames = [];
        }
      }),
    );
  }

  if (review) {
    await Promise.all(
      rows.map(async (row) => {
        if (!row.prUrl) return;
        try {
          const summary = await fetchPrReviewSummary(row.prUrl, runner, cwd);
          if (summary !== null) row.review = summary.unresolved;
        } catch {
          // leave review undefined on failure
        }
      }),
    );
  }

  const sorted = sortRows(rows);

  process.stdout.write(`\nLinear tickets: ${sorted.length} issue(s)\n`);
  if (sorted.length === 0) return;

  const nextPickIndex = selectNextPickIndex(sorted);
  const idWidth = Math.max(10, ...sorted.map((r) => r.identifier.length));
  const bucketWidth = Math.max(6, ...sorted.map((r) => r.bucketLabel.length));
  const stateWidth = Math.max(5, ...sorted.map((r) => r.stateName.length));
  const markers = sorted.map((r) => formatPrStatusMarker(r.status, r.failedCheckNames));
  const markerWidth = Math.max(9, ...markers.map((m) => m.length));
  const blockedCells = sorted.map((r) => formatBlockedCell(r.blockedByIdentifiers));
  const blockedWidth = Math.max(7, ...blockedCells.map((c) => c.length));
  const reviewCells = review ? sorted.map((r) => formatReviewCell(r.prUrl, r.review)) : null;

  const reviewHeader = reviewCells ? `  ${pad("Unresolved", 10)}` : "";
  process.stdout.write(
    `  ${pad("Identifier", idWidth)}  ${pad("Bucket", bucketWidth)}  ${pad("State", stateWidth)}  ${pad("Title", 60)}  ${pad("PR Status", markerWidth)}  ${pad("Blocked", blockedWidth)}${reviewHeader}  PR URL\n`,
  );
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i]!;
    const reviewCell = reviewCells ? `  ${pad(reviewCells[i]!, 10)}` : "";
    const pickPrefix = nextPickIndex === i ? "▶ " : "  ";
    process.stdout.write(
      `${pickPrefix}${pad(r.identifier, idWidth)}  ${pad(r.bucketLabel, bucketWidth)}  ${pad(r.stateName, stateWidth)}  ${pad(r.title, 60)}  ${pad(markers[i]!, markerWidth)}  ${pad(blockedCells[i]!, blockedWidth)}${reviewCell}  ${r.prUrl ?? "(no PR)"}\n`,
    );
  }
}
