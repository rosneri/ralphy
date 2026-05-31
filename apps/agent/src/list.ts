import { join } from "node:path";
import { getStorage, getLayout } from "@ralphy/context";
import type { GetIndicator, Indicators, Marker } from "@ralphy/types";
import { worktreesDir } from "./agent/worktree";
import { loadRalphyConfig } from "./agent/config";
import {
  fetchOpenIssues,
  fetchAttachmentsForIssues,
  type LinearFilterSpec,
  type LinearIssue,
} from "./agent/linear";
import { fetchPrStatus, type PrStatus } from "./pr-status";
import type { CmdRunner } from "./agent/pr";
import { discoverPrUrlFromGitHub } from "./agent/pr-url";
import { sortRows, type SortableRow } from "./list-sort";
import { RALPHY_ATTACHMENT_TITLE } from "./shared/capabilities/linear-client";
import { unionMarkers } from "./agent/wire/indicators";

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
): Promise<LinearIssue[]> {
  if (!bucket.indicator || bucket.indicator.filter.length === 0) return [];
  const spec: LinearFilterSpec = {
    team,
    assignee,
    include: bucket.indicator.filter,
    exclude: bucket.exclude,
  };
  return fetchOpenIssues(apiKey, spec);
}

interface UnifiedRow extends SortableRow {
  issueId: string;
  bucketLabel: string;
  stateName: string;
  title: string;
  prUrl: string | null;
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

/** Render the PR status as a short marker for the unified list table. */
function formatPrStatusMarker(status: PrStatus | null): string {
  if (status === null) return "(no PR)";
  if (status.kind === "error") return "?";
  if (status.state === "MERGED") return "merged";
  if (status.state === "CLOSED") return "closed";
  const parts: string[] = [];
  if (status.mergeable === "CONFLICTING") parts.push("✗conflict");
  if (status.ciBucket === "fail") parts.push("✗ci");
  if (status.ciBucket === "pending") parts.push("⏳ci");
  if (status.isDraft) parts.push("draft");
  if (status.autoMergeEnabled) parts.push("auto-merge");
  if (parts.length === 0) return "ok";
  return parts.join(" ");
}

async function fetchAndPrintLinear(
  apiKey: string,
  buckets: Bucket[],
  team: string | undefined,
  assignee: string | undefined,
  cwd: string,
  runner: CmdRunner,
): Promise<void> {
  // Fan out across buckets in parallel.
  const bucketResults = await Promise.all(
    buckets.map(async (bucket) => {
      if (!bucket.indicator || bucket.indicator.filter.length === 0) {
        return { bucket, issues: [] as LinearIssue[], error: null as string | null };
      }
      try {
        const issues = await fetchBucketIssues(apiKey, bucket, team, assignee);
        return { bucket, issues, error: null };
      } catch (err) {
        return {
          bucket,
          issues: [] as LinearIssue[],
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

  // Dedupe by issue id, remembering bucket label and original Linear order.
  const seen = new Map<string, UnifiedRow>();
  let order = 0;
  for (const { bucket, issues } of bucketResults) {
    for (const issue of issues) {
      if (seen.has(issue.id)) continue;
      seen.set(issue.id, {
        issueId: issue.id,
        identifier: issue.identifier,
        status: null,
        bucketOrder: order++,
        issueCreatedAt: issue.createdAt,
        bucketLabel: bucket.label,
        stateName: issue.state.name,
        title: issue.title.slice(0, 60),
        prUrl: null,
      });
    }
  }
  const rows = [...seen.values()];

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
      row.status = await fetchPrStatus(row.prUrl, runner, cwd);
    }),
  );

  const sorted = sortRows(rows);

  process.stdout.write(`\nLinear tickets: ${sorted.length} issue(s)\n`);
  if (sorted.length === 0) return;

  const idWidth = Math.max(10, ...sorted.map((r) => r.identifier.length));
  const bucketWidth = Math.max(6, ...sorted.map((r) => r.bucketLabel.length));
  const stateWidth = Math.max(5, ...sorted.map((r) => r.stateName.length));
  const markers = sorted.map((r) => formatPrStatusMarker(r.status));
  const markerWidth = Math.max(9, ...markers.map((m) => m.length));

  process.stdout.write(
    `  ${pad("Identifier", idWidth)}  ${pad("Bucket", bucketWidth)}  ${pad("State", stateWidth)}  ${pad("Title", 60)}  ${pad("PR Status", markerWidth)}  PR URL\n`,
  );
  for (let i = 0; i < sorted.length; i += 1) {
    const r = sorted[i]!;
    process.stdout.write(
      `  ${pad(r.identifier, idWidth)}  ${pad(r.bucketLabel, bucketWidth)}  ${pad(r.stateName, stateWidth)}  ${pad(r.title, 60)}  ${pad(markers[i]!, markerWidth)}  ${r.prUrl ?? "(no PR)"}\n`,
    );
  }
}

interface RunListInput {
  linearTeamOverride: string;
  linearAssigneeOverride: string;
  debug: boolean;
  name: string;
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

  const cfg = await loadRalphyConfig(projectRoot);
  const apiKey = process.env["LINEAR_API_KEY"];
  const indicators = cfg.linear.indicators as Indicators;
  const team = input.linearTeamOverride || cfg.linear.team;
  const assignee = input.linearAssigneeOverride || cfg.linear.assignee;
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

  if (team) process.stdout.write(`\nteam: ${team}\n`);
  if (assignee) process.stdout.write(`assignee: ${assignee}\n`);

  await fetchAndPrintLinear(apiKey, buckets, team, assignee, projectRoot, localCmdRunner);
}

// ---------------------------------------------------------------------------
// Debug: explain why a specific identifier was not picked up
// ---------------------------------------------------------------------------

interface DebugInput {
  identifier: string;
  projectRoot: string;
  linearTeamOverride: string;
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
  relations: {
    nodes: {
      type: string;
      relatedIssue: { id: string; identifier: string; state: { type: string } };
    }[];
  };
}

/**
 * Resolve the user-supplied --name argument to a Linear identifier
 * (e.g. "DOO-6"). Accepts either:
 *   - a raw Linear identifier in any case ("DOO-6", "doo-6")
 *   - a local change-name slug produced by changeNameForIssue
 *     ("doo-6-test2") — the leading `<team>-<number>` is extracted.
 * Returns null when the input cannot be coerced into a Linear identifier.
 */
function normalizeIdentifier(input: string): string | null {
  const match = input.match(/^([A-Za-z]+)-(\d+)(?:-.*)?$/);
  if (!match) return null;
  return `${match[1]!.toUpperCase()}-${match[2]}`;
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
        relations(first: 50) {
          nodes { type relatedIssue { id identifier state { type } } }
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

function assigneeMatches(issue: RawIssue, assignee: string | undefined): boolean {
  if (!assignee) return true;
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

  const cfg = await loadRalphyConfig(projectRoot);
  const indicators = cfg.linear.indicators as Indicators;
  const team = input.linearTeamOverride || cfg.linear.team;
  const assignee = input.linearAssigneeOverride || cfg.linear.assignee;

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

  const blockedBy = issue.relations.nodes
    .filter(
      (r) =>
        r.type === "blocked_by" &&
        r.relatedIssue.state.type !== "completed" &&
        r.relatedIssue.state.type !== "cancelled",
    )
    .map((r) => r.relatedIssue.identifier);

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
    if (!assigneeMatches(issue, assignee)) {
      reasons.push(
        `assignee mismatch: issue=${issue.assignee ? (issue.assignee.email ?? issue.assignee.id) : "unassigned"}, config=${assignee}`,
      );
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
