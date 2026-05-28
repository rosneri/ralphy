import type { Indicators, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import {
  fetchOpenIssues,
  fetchWorkflowStates,
  fetchIssueLabels,
  fetchTeamIdByKey,
  updateIssueState,
  upsertRalphyAttachment,
  fetchProjectIdByName,
  setIssueProject,
  createIssueLabel,
  addLabelToIssue,
  removeLabelFromIssue,
  issueMatchesGetIndicator,
  type LinearIssue,
  type LinearFilterSpec,
} from "../linear";

interface LinearResolversInput {
  apiKey: string;
  team: string | undefined;
  assignee: string | undefined;
  diag: (area: string, message: string, color?: string) => void;
}

interface LinearResolvers {
  applyIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  removeIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  applyMarker: (issue: LinearIssue, m: Marker) => Promise<void>;
  resolveLabelId: (issue: LinearIssue, name: string, group?: string) => Promise<string | null>;
  fetchByGet: (
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ) => Promise<LinearIssue[]>;
  /** For use by callers needing label resolution with a raw team key. */
  resolveLabelIdForTeam: (
    teamKey: string,
    labelName: string,
    group?: string,
  ) => Promise<string | null>;
}

export function createLinearResolvers(input: LinearResolversInput): LinearResolvers {
  const { apiKey, team, assignee, diag } = input;

  const stateCache = new Map<string, Map<string, string>>();
  const labelCache = new Map<string, Map<string, string>>();
  const teamIdCache = new Map<string, string>();
  const teamKeyOf = (issue: LinearIssue): string => issue.identifier.split("-")[0]!;

  async function resolveStateId(issue: LinearIssue, name: string): Promise<string | null> {
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
    issue: LinearIssue,
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

  async function applyMarker(issue: LinearIssue, m: Marker): Promise<void> {
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
      await addLabelToIssue(apiKey, issue.id, id);
      diag("linear-marker", `  → ${issue.identifier} +label='${display}'`, "gray");
    }
    // `comment` markers are read-only and rejected for setX at schema-load
    // time, so they never reach applyMarker in practice — fall through.
  }

  async function applyIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
    for (const m of markersOf(ind)) await applyMarker(issue, m);
  }

  async function removeIndicator(issue: LinearIssue, ind: SetIndicator): Promise<void> {
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
  ): Promise<LinearIssue[]> {
    if (!inc) return [];
    const include = !Array.isArray(inc) && "filter" in inc ? inc.filter : [];
    if (include.length === 0) return [];
    const hasCommentMarker = include.some((m) => m.type === "comment");
    const spec: LinearFilterSpec = { team, assignee, include, exclude: excl };
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
    const fakeIssue = { identifier: `${teamKey}-0` } as LinearIssue;
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

export function fetchDoneCandidatesWith(
  apiKey: string,
  team: string | undefined,
  assignee: string | undefined,
  indicators: Indicators,
): Promise<LinearIssue[]> {
  if (!indicators.setDone) return Promise.resolve([]);
  const include = markersOf(indicators.setDone);
  if (include.length === 0) return Promise.resolve([]);
  return fetchOpenIssues(apiKey, { team, assignee, include, exclude: [] });
}
