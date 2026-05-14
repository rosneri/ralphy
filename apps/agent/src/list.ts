import { join } from "node:path";
import { getStorage } from "@ralphy/context";
import type { GetIndicator, Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import { worktreesDir } from "./agent/worktree";
import { loadRalphyConfig } from "./agent/config";
import {
  fetchOpenIssues,
  fetchIssueAttachments,
  type LinearFilterSpec,
  type LinearIssue,
} from "./agent/linear";

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

function buildLocalRows(statesDir: string, projectRoot: string): LocalRow[] {
  const storage = getStorage();
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

function unionMarkers(...sets: (SetIndicator | undefined)[]): Marker[] {
  const out: Marker[] = [];
  const seen = new Set<string>();
  for (const s of sets) {
    if (!s) continue;
    for (const m of markersOf(s)) {
      const key = `${m.type}:${m.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

interface Bucket {
  label: string;
  indicator: GetIndicator | undefined;
  exclude: Marker[];
}

function buildBuckets(indicators: Indicators): Bucket[] {
  const excludeFromTodo = unionMarkers(
    indicators.setDone,
    indicators.setError,
    indicators.setConflicted,
  );
  const excludeFromReview = unionMarkers(
    indicators.setInProgress,
    indicators.setError,
    indicators.setConflicted,
  );
  return [
    { label: "todo", indicator: indicators.getTodo, exclude: excludeFromTodo },
    { label: "in-progress", indicator: indicators.getInProgress, exclude: [] },
    { label: "conflicted", indicator: indicators.getConflicted, exclude: [] },
    { label: "review", indicator: indicators.getReview, exclude: excludeFromReview },
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

async function printBucket(
  apiKey: string,
  bucket: Bucket,
  team: string | undefined,
  assignee: string | undefined,
): Promise<void> {
  if (!bucket.indicator || bucket.indicator.filter.length === 0) {
    return;
  }
  let issues: LinearIssue[] = [];
  try {
    issues = await fetchBucketIssues(apiKey, bucket, team, assignee);
  } catch (err) {
    process.stdout.write(
      `\n${bucket.label}: error fetching from Linear — ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }

  const filterStr = bucket.indicator.filter.map((m) => `${m.type}:${m.value}`).join(", ");
  process.stdout.write(`\n${bucket.label} [${filterStr}] — ${issues.length} issue(s)\n`);
  if (issues.length === 0) return;

  const prUrls = await Promise.all(
    issues.map(async (issue) => {
      try {
        const attachments = await fetchIssueAttachments(apiKey, issue.id);
        return findPullRequestUrl(attachments);
      } catch {
        return null;
      }
    }),
  );

  const idWidth = Math.max(3, ...issues.map((i) => i.identifier.length));
  const stateWidth = Math.max(5, ...issues.map((i) => i.state.name.length));
  for (let index = 0; index < issues.length; index += 1) {
    const issue = issues[index]!;
    const pr = prUrls[index];
    const title = issue.title.slice(0, 60);
    process.stdout.write(
      `  ${pad(issue.identifier, idWidth)}  ${pad(issue.state.name, stateWidth)}  ${pad(title, 60)}  ${pr ?? "(no PR)"}\n`,
    );
  }
}

interface RunListInput {
  statesDir: string;
  projectRoot: string;
  linearTeamOverride: string;
  linearAssigneeOverride: string;
  debug: boolean;
  name: string;
}

export async function runList(input: RunListInput): Promise<void> {
  const { statesDir, projectRoot, debug, name } = input;

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

  const rows = buildLocalRows(statesDir, projectRoot);
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

  process.stdout.write("\nLinear tickets:\n");
  if (team) process.stdout.write(`  team: ${team}\n`);
  if (assignee) process.stdout.write(`  assignee: ${assignee}\n`);

  for (const bucket of buckets) {
    await printBucket(apiKey, bucket, team, assignee);
  }
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

const RALPHY_ATTACHMENT_TITLE = "Ralphy";

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
