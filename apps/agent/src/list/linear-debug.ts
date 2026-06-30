import { getArgs } from "@ralphy/context";
import { resolveLinearFilter, applyAssigneeOverride } from "@ralphy/workflow";
import type { Indicators, Marker } from "@ralphy/types";
import { loadEffectiveConfig } from "../agent/config";
import {
  parseTicketIdentifier,
  type ParsedTicketIdentifier,
} from "../shared/capabilities/linear-client/ticket-identifier";
import { RALPHY_ATTACHMENT_TITLE } from "../shared/capabilities/linear-client/attachments";
import { buildBuckets } from "./formatting";

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

export async function runListDebug(input: DebugInput): Promise<void> {
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
