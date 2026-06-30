import { join } from "node:path";
import { getStorage, getLayout, getArgs } from "@ralphy/context";
import { resolveLinearFilter, linearFilterScope, applyAssigneeOverride } from "@ralphy/workflow";
import type { GetIndicator, Indicators, LinearFilterScope, Marker } from "@ralphy/types";
import { worktreesDir } from "./agent/worktree";
import { loadEffectiveConfig } from "./agent/config";
import {
  fetchOpenIssues,
  fetchAttachmentsForIssues,
  fetchViewer,
  type LinearFilterSpec,
} from "./shared/capabilities/linear-client";
import type { TrackedIssue } from "@ralphy/tracker";
import { fetchPrStatus, type PrStatus } from "./pr-status";
import { createGhCliCodeHost } from "@ralphy/codehost";
import type { CmdRunner } from "./agent/pr";
import { discoverPrUrlFromGitHub } from "./agent/pr-url";
import { sortRows, type SortableRow } from "./list-sort";
import { orderIssuesHierarchically } from "@ralphy/core/ordering";
import { linearIssueToOrderable } from "./queue/queue-order";
import { getPrChecksStatus } from "./agent/ci";
import {
  RALPHY_ATTACHMENT_TITLE,
  parseTicketIdentifier,
  resolveTicketNumbers,
  formatTicketError,
  type ParsedTicketIdentifier,
} from "./shared/capabilities/linear-client";
import { unionMarkers } from "./agent/wire/indicators";
import { fetchPrReviewSummary } from "./shared/pr/review-state";

interface LocalRow {
  name: string;
  status: string;
  iters: string;
  progress: string;
  prompt: string;
  source: string;
}

function countTaskItems(content: string): { checked: number; unchecked: number } {
  const checked = (content.match(/^- \[x\]/gm) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, unchecked };
}

function buildLocalRows(): LocalRow[] {
  const storage = getStorage();
  const layout = getLayout();
  const statesDir = layout.statesDir;
  const projectRoot = layout.root;
  const rows: LocalRow[] = [];
  const seen = new Set<string>();

  const sources: { dir: string; label: string }[] = [{ dir: statesDir, label: "main" }];
  const worktreesRoot = worktreesDir(projectRoot);
  for (const wt of storage.list(worktreesRoot)) {
    sources.push({ dir: join(worktreesRoot, wt, ".ralph", "tasks"), label: `wt:${wt}` });
  }

  for (const { dir, label } of sources) {
    for (const entry of storage.list(dir)) {
      if (seen.has(entry)) continue;
      const raw = storage.read(join(dir, entry, ".ralph-state.json"));
      if (raw === null) continue;
      let state: Record<string, unknown>;
      try {
        state = JSON.parse(raw);
      } catch {
        continue;
      }
      if (String(state.status ?? "") === "completed") continue;

      const promptRaw = String(state.prompt ?? "");
      const firstLine = promptRaw.split("\n").find((l) => l.trim() !== "") ?? "";

      let progress = "—";
      const tasksContent = storage.read(join(dir, entry, "tasks.md"));
      if (tasksContent !== null) {
        const { checked, unchecked } = countTaskItems(tasksContent);
        const total = checked + unchecked;
        if (total > 0) progress = `${checked}/${total}`;
      }

      seen.add(entry);
      rows.push({
        name: String(state.name ?? entry),
        status: String(state.status ?? "unknown"),
        iters: String(state.iteration ?? 0),
        progress,
        prompt: firstLine
          .replace(/^#+\s*/, "")
          .trim()
          .slice(0, 60),
        source: label,
      });
    }
  }
  return rows;
}

function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function printLocalRows(rows: LocalRow[]): void {
  if (rows.length === 0) {
    process.stdout.write("\n  No incomplete local tasks.\n");
    return;
  }
  const cols = {
    name: Math.max(4, ...rows.map((r) => r.name.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    iters: 5,
    progress: 8,
    source: Math.max(6, ...rows.map((r) => r.source.length)),
  };
  process.stdout.write("\nLocal tasks:\n");
  process.stdout.write(
    `${pad("Name", cols.name)}  ${pad("Status", cols.status)}  ${pad("Iters", cols.iters)}  ${pad("Progress", cols.progress)}  ${pad("Source", cols.source)}  Description\n`,
  );
  for (const r of rows) {
    process.stdout.write(
      `${pad(r.name, cols.name)}  ${pad(r.status, cols.status)}  ${pad(r.iters, cols.iters)}  ${pad(r.progress, cols.progress)}  ${pad(r.source, cols.source)}  ${r.prompt}\n`,
    );
  }
}

function findPullRequestUrl(
  attachments: { url: string; sourceType: string | null }[],
): string | null {
  for (const a of attachments) {
    if (/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(a.url)) return a.url;
  }
  return null;
}

interface Bucket {
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

async function fetchBucketIssues(
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

const localCmdRunner: CmdRunner = {
  run: async (cmd, cwd) => {
    const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    if (code !== 0) {
      const err = new Error(`\`${cmd.join(" ")}\` exited ${code}`) as Error & {
        stderr?: string;
      };
      err.stderr = stderr;
      throw err;
    }
    return { stdout, stderr };
  },
};

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

async function fetchAndPrintLinear(
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

interface RunListInput {
  linearTeamOverride: string | undefined;
  linearAssigneeOverride: string;
  debug: boolean;
  name: string;
  checks: boolean;
  review: boolean;
  /** RLF-208: raw `--ticket` tokens to restrict the listing to. */
  ticketTokens?: string[];
}

export async function runList(input: RunListInput): Promise<void> {
  const { debug, name } = input;
  const projectRoot = getLayout().root;

  if (debug) {
    if (!name) {
      process.stderr.write("Error: --name is required when using --debug\n");
      process.exitCode = 1;
      return;
    }
    await runListDebug({
      identifier: name,
      projectRoot,
      linearTeamOverride: input.linearTeamOverride,
      linearAssigneeOverride: input.linearAssigneeOverride,
    });
    return;
  }

  const rows = buildLocalRows();
  printLocalRows(rows);

  const args = getArgs();
  const extra =
    input.linearTeamOverride === undefined ? {} : { linearTeam: input.linearTeamOverride };
  const cfg = await loadEffectiveConfig(projectRoot, args.workflowFile, args.overrides, extra);
  const apiKey = process.env["LINEAR_API_KEY"];
  const indicators = cfg.linear.indicators as Indicators;
  const team = cfg.linear.team;
  const resolved = resolveLinearFilter(
    applyAssigneeOverride(cfg.linear.filter, input.linearAssigneeOverride),
  );
  const { assignee, anyAssignee } = resolved;
  const scope = linearFilterScope(resolved);
  const buckets = buildBuckets(indicators);
  const anyConfigured = buckets.some((b) => b.indicator && b.indicator.filter.length > 0);

  if (!anyConfigured) {
    process.stdout.write(
      "\nLinear: no get* indicators configured in WORKFLOW.md — skipping ticket fetch.\n",
    );
    return;
  }

  if (!apiKey) {
    process.stdout.write(
      "\nLinear: LINEAR_API_KEY not set — cannot fetch tickets. Configured buckets:\n",
    );
    for (const bucket of buckets) {
      if (!bucket.indicator || bucket.indicator.filter.length === 0) continue;
      const filterStr = bucket.indicator.filter.map((m) => `${m.type}:${m.value}`).join(", ");
      process.stdout.write(`  ${bucket.label} [${filterStr}]\n`);
    }
    return;
  }

  let ticketNumbers: number[] = [];
  try {
    ticketNumbers = resolveTicketNumbers(input.ticketTokens ?? [], team);
  } catch (err) {
    process.stderr.write(`Error: ${formatTicketError(err)}\n`);
    process.exitCode = 1;
    return;
  }

  if (team) process.stdout.write(`\nteam: ${team}\n`);
  process.stdout.write(`assignee: ${anyAssignee ? "any" : (assignee ?? "*")}\n`);
  if (ticketNumbers.length > 0) process.stdout.write(`ticket: ${ticketNumbers.join(", ")}\n`);

  // Surface the authenticated user so a key that resolves `assignee: me` to the
  // wrong account (or no account) is visible — otherwise it silently fetches
  // zero tickets and looks like nothing matched.
  const viewer = await fetchViewer(apiKey);
  if (viewer) {
    process.stdout.write(`authed as: ${viewer.name} <${viewer.email}>\n`);
  } else {
    process.stdout.write(
      "authed as: (LINEAR_API_KEY did not resolve a user — key may be invalid or expired)\n",
    );
  }

  await fetchAndPrintLinear(
    apiKey,
    buckets,
    team,
    assignee,
    anyAssignee,
    scope,
    projectRoot,
    localCmdRunner,
    cfg.prRecovery.ignoreChecks,
    input.checks,
    input.review,
    ticketNumbers,
  );
}

// ---------------------------------------------------------------------------
// Debug: explain why a specific identifier was not picked up
// ---------------------------------------------------------------------------

interface DebugInput {
  identifier: string;
  projectRoot: string;
  linearTeamOverride: string | undefined;
  linearAssigneeOverride: string;
}

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  team: { key: string } | null;
  labels: { nodes: { name: string }[] };
  attachments: { nodes: { title: string | null; subtitle: string | null }[] };
  // Blockers live in `inverseRelations` (stored type `blocks`, `issue` = the
  // blocker) — Linear has no `blocked_by` relation type. See linear-client.
  inverseRelations: {
    nodes: {
      type: string;
      issue: { id: string; identifier: string; state: { type: string } };
    }[];
  };
}

function normalizeIdentifier(input: string): string | null {
  let parsed: ParsedTicketIdentifier;
  try {
    parsed = parseTicketIdentifier(input);
  } catch {
    return null;
  }
  if (parsed.teamKey === null) return null;
  return `${parsed.teamKey}-${parsed.number}`;
}

async function fetchIssueByIdentifier(
  apiKey: string,
  identifier: string,
): Promise<RawIssue | null> {
  const match = identifier.match(/^([A-Z]+)-(\d+)$/);
  if (!match) return null;
  const teamKey = match[1]!;
  const number = Number(match[2]!);
  const query = `query($team: String!, $number: Float!) {
    issues(filter: { team: { key: { eq: $team } }, number: { eq: $number } }, first: 1) {
      nodes {
        id identifier title url
        state { name type }
        assignee { id email name }
        team { key }
        labels { nodes { name } }
        attachments(first: 25) { nodes { title subtitle } }
        inverseRelations(first: 50) {
          nodes { type issue { id identifier state { type } } }
        }
      }
    }
  }`;
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables: { team: teamKey, number } }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { issues?: { nodes?: RawIssue[] } } };
  return json.data?.issues?.nodes?.[0] ?? null;
}

function markerMatches(issue: RawIssue, marker: Marker): boolean {
  if (marker.type === "label") {
    const labels = new Set(issue.labels.nodes.map((l) => l.name.toLowerCase()));
    return labels.has(marker.value.toLowerCase());
  }
  if (marker.type === "attachment") {
    return issue.attachments.nodes.some(
      (a) =>
        a.title === RALPHY_ATTACHMENT_TITLE &&
        (a.subtitle ?? "").toLowerCase() === marker.value.toLowerCase(),
    );
  }
  if (marker.type === "status") {
    return issue.state.name.toLowerCase() === marker.value.toLowerCase();
  }
  return false;
}

function assigneeMatches(
  issue: RawIssue,
  assignee: string | undefined,
  anyAssignee: boolean | undefined,
): boolean {
  if (anyAssignee) return true;
  if (!assignee || assignee === "unassigned") return issue.assignee === null;
  const a = issue.assignee;
  if (!a) return false;
  if (assignee === "me") return true; // can't verify without `me` query
  if (assignee.includes("@")) return a.email?.toLowerCase() === assignee.toLowerCase();
  return a.id === assignee;
}

async function runListDebug(input: DebugInput): Promise<void> {
  const { identifier, projectRoot } = input;
  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    process.stderr.write("Error: LINEAR_API_KEY not set — cannot query Linear\n");
    process.exitCode = 1;
    return;
  }

  const args = getArgs();
  const extra =
    input.linearTeamOverride === undefined ? {} : { linearTeam: input.linearTeamOverride };
  const cfg = await loadEffectiveConfig(projectRoot, args.workflowFile, args.overrides, extra);
  const indicators = cfg.linear.indicators as Indicators;
  const team = cfg.linear.team;
  const { assignee, anyAssignee, requireAllLabels, excludeLabels } = resolveLinearFilter(
    applyAssigneeOverride(cfg.linear.filter, input.linearAssigneeOverride),
  );
  const assigneeLabel = anyAssignee ? "any" : (assignee ?? "*");

  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    process.stdout.write(
      `Error: '${identifier}' does not look like a Linear identifier (expected e.g. DOO-6, or a local change name beginning with one).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Looking up ${normalized}${normalized === identifier ? "" : ` (from '${identifier}')`} on Linear…\n`,
  );
  const issue = await fetchIssueByIdentifier(apiKey, normalized);
  if (!issue) {
    process.stdout.write(`Issue ${normalized} not found (or LINEAR_API_KEY lacks access).\n`);
    return;
  }

  process.stdout.write(
    `\nFound ${issue.identifier} — "${issue.title}"\n` +
      `  url: ${issue.url}\n` +
      `  state: ${issue.state.name} (${issue.state.type})\n` +
      `  team: ${issue.team?.key ?? "(unknown)"}\n` +
      `  assignee: ${issue.assignee ? `${issue.assignee.name} <${issue.assignee.email ?? "no-email"}>` : "(unassigned)"}\n` +
      `  labels: ${issue.labels.nodes.map((l) => l.name).join(", ") || "(none)"}\n`,
  );

  const blockedBy = issue.inverseRelations.nodes
    .filter(
      (r) =>
        r.type === "blocks" &&
        r.issue.state.type !== "completed" &&
        r.issue.state.type !== "cancelled",
    )
    .map((r) => r.issue.identifier);

  process.stdout.write(`\nPer-bucket diagnostics:\n`);

  const buckets = buildBuckets(indicators);
  for (const bucket of buckets) {
    if (!bucket.indicator || bucket.indicator.filter.length === 0) {
      process.stdout.write(`\n  ${bucket.label}: not configured.\n`);
      continue;
    }
    const reasons: string[] = [];

    if (team && issue.team?.key && issue.team.key !== team) {
      reasons.push(`team mismatch: issue=${issue.team.key}, config=${team}`);
    }
    if (!assigneeMatches(issue, assignee, anyAssignee)) {
      reasons.push(
        `assignee mismatch: issue=${issue.assignee ? (issue.assignee.email ?? issue.assignee.id) : "unassigned"}, config=${assigneeLabel}`,
      );
    }
    if (requireAllLabels && requireAllLabels.length > 0) {
      const issueLabels = new Set(issue.labels.nodes.map((l) => l.name));
      const missing = requireAllLabels.filter((label) => !issueLabels.has(label));
      if (missing.length > 0) {
        reasons.push(`missing required linear.filter label(s): ${missing.join(", ")}`);
      }
    }
    if (excludeLabels && excludeLabels.length > 0) {
      const issueLabels = new Set(issue.labels.nodes.map((l) => l.name));
      const present = excludeLabels.filter((label) => issueLabels.has(label));
      if (present.length > 0) {
        reasons.push(`carries excluded linear.filter label(s): ${present.join(", ")}`);
      }
    }

    const includeMatches = bucket.indicator.filter.some((m) => markerMatches(issue, m));
    if (!includeMatches) {
      const want = bucket.indicator.filter.map((m) => `${m.type}:${m.value}`).join(" OR ");
      reasons.push(`include filter not matched (needs any of: ${want})`);
    }

    const excludedBy = bucket.exclude.filter((m) => markerMatches(issue, m));
    if (excludedBy.length > 0) {
      reasons.push(
        `excluded by markers: ${excludedBy.map((m) => `${m.type}:${m.value}`).join(", ")}`,
      );
    }

    if (bucket.label === "todo" || bucket.label === "in-progress") {
      if (blockedBy.length > 0) {
        reasons.push(`blocked by unfinished issues: ${blockedBy.join(", ")}`);
      }
    }

    if (reasons.length === 0) {
      process.stdout.write(`\n  ${bucket.label}: ✓ would be picked up by this bucket.\n`);
    } else {
      process.stdout.write(`\n  ${bucket.label}: ✗ skipped\n`);
      for (const reason of reasons) process.stdout.write(`      - ${reason}\n`);
    }
  }
}
