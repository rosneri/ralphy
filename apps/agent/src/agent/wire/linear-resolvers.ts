import type {
  GetIndicator,
  Indicators,
  LinearFilterScope,
  Marker,
  SetIndicator,
} from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { TrackerProvider } from "./tracker/types";
import {
  issueMatchesGetIndicator,
  type LinearFilterSpec,
} from "../../shared/capabilities/linear-client/filters";
import {
  fetchOpenIssues,
  fetchWorkflowStates,
  updateIssueState,
} from "../../shared/capabilities/linear-client/issues";
import { upsertRalphyAttachment } from "../../shared/capabilities/linear-client/attachments";
import {
  fetchIssueLabels,
  fetchTeamIdByKey,
  fetchProjectIdByName,
  setIssueProject,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
} from "../../shared/capabilities/linear-client/labels-and-projects";
import type { TrackedIssue } from "@ralphy/tracker";
import { linearIdentifierStrategy } from "../../shared/capabilities/github/identifier-strategy";

interface LinearResolversInput {
  apiKey: string;
  team: string | undefined;
  assignee: string | undefined;
  /** When true, fetch regardless of assignee (`assignee = any`). */
  anyAssignee?: boolean | undefined;
  /** Global `linear.filter` label/project constraints ANDed onto every fetch
   *  (must-have/must-not labels, project scope). */
  scope: LinearFilterScope;
  diag: (area: string, message: string, color?: string) => void;
  /** RLF-208: when non-empty, every `fetchByGet` query is constrained to these
   *  Linear ticket numbers (from `--ticket`). */
  ticketNumbers?: number[] | undefined;
}

/**
 * The Linear resolver surface. Conforms to {@link TrackerProvider} (minus the
 * `fetchDoneCandidates` method, which `wire.ts` binds from the standalone
 * {@link fetchDoneCandidatesWith} since it needs the indicator map), plus the
 * extra `resolveLabelId` helper used internally. Typed as an extension so any
 * drift from the provider contract is a compile error. Exported so the
 * `createLinearTrackerProvider` seam (RLF-223) can take it as input.
 */
export interface LinearResolvers extends Omit<TrackerProvider, "fetchDoneCandidates"> {
  resolveLabelId: (issue: TrackedIssue, name: string, group?: string) => Promise<string | null>;
}

export function createLinearResolvers(input: LinearResolversInput): LinearResolvers {
  const { apiKey, team, assignee, anyAssignee, scope, diag } = input;
  const ticketNumbers = input.ticketNumbers ?? [];

  const stateCache = new Map<string, Map<string, string>>();
  const labelCache = new Map<string, Map<string, string>>();
  const teamIdCache = new Map<string, string>();
  const teamKeyOf = (issue: TrackedIssue): string => linearIdentifierStrategy.scopeKey(issue);

  async function resolveStateId(issue: TrackedIssue, name: string): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = stateCache.get(t);
    if (!map) {
      const states = await fetchWorkflowStates(apiKey, t);
      map = new Map(states.map((s) => [s.name.toLowerCase(), s.id]));
      stateCache.set(t, map);
    }
    return map.get(name.toLowerCase()) ?? null;
  }

  async function resolveLabelId(
    issue: TrackedIssue,
    name: string,
    group?: string,
  ): Promise<string | null> {
    const t = teamKeyOf(issue);
    let map = labelCache.get(t);
    if (!map) {
      const labels = await fetchIssueLabels(apiKey, t);
      map = new Map(labels.map((l) => [l.name.toLowerCase(), l.id]));
      labelCache.set(t, map);
    }
    // When the marker carries a group, look the label up as
    // `${group}:${value}` — matching the `Parent:Child` key that
    // `fetchIssueLabels` produces for nested labels.
    const lookupKey = group ? `${group}:${name}`.toLowerCase() : name.toLowerCase();
    const existing = map.get(lookupKey);
    if (existing) return existing;
    try {
      let teamId = teamIdCache.get(t);
      if (!teamId) {
        const fetched = await fetchTeamIdByKey(apiKey, t);
        if (!fetched) return null;
        teamId = fetched;
        teamIdCache.set(t, teamId);
      }
      const newId = await createIssueLabel(apiKey, teamId, name);
      if (!newId) return null;
      map.set(name.toLowerCase(), newId);
      diag("linear-label", `  created Linear label '${name}' for team ${t}`, "gray");
      return newId;
    } catch (err) {
      const e = err as Error & { messages?: string[] };
      const detail = e.messages?.length ? ` — ${e.messages.join("; ")}` : "";
      diag(
        "linear-label",
        `! Linear label '${name}' creation threw: ${e.message}${detail}`,
        "yellow",
      );
      labelCache.delete(t);
      return null;
    }
  }

  /**
   * Linear label groups are exclusive — an issue can hold at most one label
   * per group. Before adding a grouped label, strip any sibling from the same
   * group the issue already carries, otherwise `issueAddLabel` is rejected
   * (surfaced as "Linear API returned errors"), which is what stalls a
   * `setError`/`setConflicted` on an issue that still has e.g. `approved`.
   *
   * `issue.labels` holds bare child names, so a sibling is any current label
   * whose `${group}:${name}` resolves in the (already-populated) label cache to
   * a different id than the one we are about to add. Removal failures are
   * non-fatal — the add is still attempted.
   */
  async function stripSiblingGroupLabels(
    issue: TrackedIssue,
    group: string,
    keepId: string,
  ): Promise<void> {
    const map = labelCache.get(teamKeyOf(issue));
    if (!map) return;
    for (const name of issue.labels) {
      const siblingId = map.get(`${group}:${name}`.toLowerCase());
      if (!siblingId || siblingId === keepId) continue;
      try {
        await removeLabelFromIssue(apiKey, issue.id, siblingId);
        diag(
          "linear-marker",
          `  → ${issue.identifier} -label='${group}:${name}' (group swap)`,
          "gray",
        );
      } catch (err) {
        diag(
          "linear-marker",
          `! could not remove sibling label '${group}:${name}' from ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
  }

  async function applyMarker(issue: TrackedIssue, m: Marker): Promise<void> {
    if (m.type === "status") {
      const id = await resolveStateId(issue, m.value);
      if (!id) {
        const err = new Error("Linear status not found") as Error & {
          status?: string;
          issue?: string;
        };
        err.status = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await updateIssueState(apiKey, issue.id, id);
      diag("linear-marker", `  → ${issue.identifier} status='${m.value}'`, "gray");
    } else if (m.type === "attachment") {
      await upsertRalphyAttachment(apiKey, issue.id, issue.url, m.value);
      diag("linear-marker", `  → ${issue.identifier} attachment='${m.value}'`, "gray");
    } else if (m.type === "project") {
      const projectId = await fetchProjectIdByName(apiKey, m.value);
      if (!projectId) {
        const err = new Error("Linear project not found") as Error & {
          project?: string;
          issue?: string;
        };
        err.project = m.value;
        err.issue = issue.identifier;
        throw err;
      }
      await setIssueProject(apiKey, issue.id, projectId);
      diag("linear-marker", `  → ${issue.identifier} project='${m.value}'`, "gray");
    } else if (m.type === "label") {
      const id = await resolveLabelId(issue, m.value, m.group);
      const display = m.group ? `${m.group}:${m.value}` : m.value;
      if (!id) {
        const err = new Error("Linear label could not be resolved") as Error & {
          label?: string;
          issue?: string;
        };
        err.label = display;
        err.issue = issue.identifier;
        throw err;
      }
      // Exclusive Linear groups reject a second label from the same group;
      // swap out any sibling the issue already carries before adding.
      if (m.group) await stripSiblingGroupLabels(issue, m.group, id);
      await addLabelToIssue(apiKey, issue.id, id);
      diag("linear-marker", `  → ${issue.identifier} +label='${display}'`, "gray");
    }
    // `comment` markers are read-only and rejected for setX at schema-load
    // time, so they never reach applyMarker in practice — fall through.
  }

  async function applyIndicator(issue: TrackedIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) await applyMarker(issue, m);
  }

  async function removeIndicator(issue: TrackedIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) {
      if (m.type !== "label") continue;
      const id = await resolveLabelId(issue, m.value, m.group);
      const display = m.group ? `${m.group}:${m.value}` : m.value;
      if (!id) {
        diag(
          "linear-marker",
          `! Linear label '${display}' not found for ${issue.identifier}`,
          "yellow",
        );
        continue;
      }
      await removeLabelFromIssue(apiKey, issue.id, id);
      diag("linear-marker", `  → ${issue.identifier} -label='${display}'`, "gray");
    }
  }

  async function fetchByGet(
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ): Promise<TrackedIssue[]> {
    if (!inc) return [];
    const include = !Array.isArray(inc) && "filter" in inc ? inc.filter : [];
    if (include.length === 0) return [];
    const hasCommentMarker = include.some((m) => m.type === "comment");
    const spec: LinearFilterSpec = {
      team,
      assignee,
      anyAssignee,
      ...scope,
      include,
      exclude: excl,
      ...(ticketNumbers.length > 0 ? { numbers: ticketNumbers } : {}),
    };
    const fetched = await fetchOpenIssues(
      apiKey,
      spec,
      hasCommentMarker ? { includeComments: true } : undefined,
    );
    if (!hasCommentMarker) return fetched;
    // When a comment marker is present, the GraphQL pre-filter can't enforce
    // it (text search on comments is client-side), so post-filter using the
    // shared matcher to drop issues that only matched the open-state default.
    return fetched.filter((i) => issueMatchesGetIndicator(i, { filter: include }));
  }

  async function resolveLabelIdForTeam(
    teamKey: string,
    labelName: string,
    group?: string,
  ): Promise<string | null> {
    const fakeIssue = { identifier: `${teamKey}-0` } as TrackedIssue;
    return resolveLabelId(fakeIssue, labelName, group);
  }

  return {
    applyIndicator,
    removeIndicator,
    applyMarker,
    resolveLabelId,
    fetchByGet,
    resolveLabelIdForTeam,
  };
}

/**
 * Fetch all issues that should be scanned for PR conflict and CI status.
 * Unions results from every configured "get" indicator (getTodo, getInProgress,
 * getDone, getReview, getAutoMerge) plus the setDone filter, deduped by id.
 *
 * Scoped to the same `assignee`/`anyAssignee` filter as `agent list`, so the
 * CI/conflict watch only acts on PRs linked to tickets the operator owns —
 * never on a teammate's tickets. (The broad bucket union is still required:
 * a ticket sits in the setDone state, e.g. "In Review", while its PR awaits or
 * fails CI, and that state is not one of the list's pick-up buckets.)
 */
/**
 * Build the per-indicator query spec for the done-candidate PR scan. Exported
 * so it can be unit-tested directly — it is the line that must carry the global
 * filter's `assignee`/`anyAssignee`/`requireAllLabels` rather than hardcoding
 * an all-assignee scan (the bug that pulled teammates' PRs into the CI watch).
 */
export function doneCandidateSpec(
  team: string | undefined,
  assignee: string | undefined,
  anyAssignee: boolean | undefined,
  scope: LinearFilterScope,
  include: Marker[],
  ticketNumbers?: number[] | undefined,
): LinearFilterSpec {
  return {
    team,
    assignee,
    anyAssignee,
    ...scope,
    include,
    exclude: [],
    ...(ticketNumbers && ticketNumbers.length > 0 ? { numbers: ticketNumbers } : {}),
  };
}

export async function fetchDoneCandidatesWith(
  apiKey: string,
  team: string | undefined,
  assignee: string | undefined,
  anyAssignee: boolean | undefined,
  scope: LinearFilterScope,
  indicators: Indicators,
  ticketNumbers?: number[] | undefined,
): Promise<TrackedIssue[]> {
  const getIndicators: GetIndicator[] = [
    indicators.getTodo,
    indicators.getInProgress,
    indicators.getDone,
    indicators.getReview,
    indicators.getAutoMerge,
  ].filter((i): i is GetIndicator => i != null);

  // Also include issues currently in the setDone state.
  if (indicators.setDone) {
    getIndicators.push({ filter: markersOf(indicators.setDone) });
  }

  if (getIndicators.length === 0) return [];

  const seen = new Set<string>();
  const results: TrackedIssue[] = [];

  await Promise.all(
    getIndicators.map(async (ind) => {
      const include = ind.filter ?? [];
      if (include.length === 0) return;
      const issues = await fetchOpenIssues(
        apiKey,
        doneCandidateSpec(team, assignee, anyAssignee, scope, include, ticketNumbers),
      );
      for (const issue of issues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id);
          results.push(issue);
        }
      }
    }),
  );

  return results;
}
