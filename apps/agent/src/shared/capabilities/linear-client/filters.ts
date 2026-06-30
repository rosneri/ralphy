import type { GetIndicator, Marker } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";
import { isRalphComment } from "../../utils/ralph-comment";

/**
 * Linear query spec used by the agent. `include` is an all-of marker list
 * (issue must match every condition). `exclude` is a none-of marker list
 * (issue must not match any). Empty lists are treated as "no constraint".
 */
export interface LinearFilterSpec {
  team?: string | undefined;
  assignee?: string | undefined;
  /** When true, skip the assignee constraint entirely (fetch regardless of who it's assigned to). */
  anyAssignee?: boolean | undefined;
  include?: Marker[] | undefined;
  exclude?: Marker[] | undefined;
  /** RLF-208: when non-empty, restrict to issues whose Linear `number` is in
   *  this set (ANDed with team/assignee/include/exclude). Set by `--ticket`. */
  numbers?: number[] | undefined;
  /** Global `linear.filter` label clauses: every entry is a MUST-HAVE label
   *  ANDed onto the query (the issue must carry all of them). Distinct from
   *  `include` labels, which are an any-of set within a lifecycle indicator. */
  requireAllLabels?: string[] | undefined;
  /** Global `linear.filter` negated label clauses: every entry is a MUST-NOT
   *  label ANDed onto the query. */
  excludeLabels?: string[] | undefined;
  /** Global `linear.filter` positive project clause: confines every fetch to a
   *  single Linear project (ANDed). The supported way to scope an agent to one
   *  project on a shared team — covers EVERY bucket, including auto-merge. */
  requireProject?: string | undefined;
  /** Global `linear.filter` negated project clauses: projects to keep out. */
  excludeProjects?: string[] | undefined;
}

interface Partitioned {
  statuses: string[];
  labels: string[];
  attachmentSubtitles: string[];
  projects: string[];
}

function partition(markers: Marker[]): Partitioned {
  const statuses: string[] = [];
  const labels: string[] = [];
  const attachmentSubtitles: string[] = [];
  const projects: string[] = [];
  for (const m of markers) {
    if (m.type === "status") statuses.push(m.value);
    else if (m.type === "label") labels.push(m.value);
    else if (m.type === "attachment") attachmentSubtitles.push(m.value);
    else if (m.type === "project") projects.push(m.value);
    // `comment` markers are filter-only and contribute no GraphQL pre-filter
    // clause; matching happens client-side in issueMatchesGetIndicator after
    // the comments slice is fetched.
  }
  return { statuses, labels, attachmentSubtitles, projects };
}

const RALPHY_ATTACHMENT_TITLE_FILTER = "Ralphy";

/**
 * AND every globally-required label onto `where` as its own mandatory clause —
 * the issue must carry ALL of them. Each becomes a separate `{labels:{some:...}}`
 * entry in `where.and` so it composes with (rather than overwrites) any include
 * label set in `where.labels`. Shared by `buildIssueFilter` and the inline
 * `fetchMentionScanIssues` builder so the global filter can never leak from one
 * query surface. No-op when there are no required labels.
 */
export function applyRequiredLabels(
  where: Record<string, unknown>,
  requireAllLabels: string[] | undefined,
): void {
  if (!requireAllLabels || requireAllLabels.length === 0) return;
  const and = (where.and as Record<string, unknown>[] | undefined) ?? [];
  // If an include label set already sits at the top level (`where.labels`),
  // move it into `and` and drop it — so the result never carries BOTH a
  // top-level `labels` and `and[].labels`. This mirrors the exclude path's
  // consolidation (the only filter shape the codebase has proven in production)
  // and keeps the include OR-set ANDed with the required must-have clauses.
  if (where.labels !== undefined) {
    and.push({ labels: where.labels });
    delete where.labels;
  }
  for (const label of requireAllLabels) {
    and.push({ labels: { some: { name: { eq: label } } } });
  }
  where.and = and;
}

/** A marker is negated when it carries `negate: true` (label/status/project). */
function isNegatedMarker(m: Marker): boolean {
  return "negate" in m && Boolean(m.negate);
}

/**
 * AND the global filter's single positive project clause onto `where` as a
 * must-be-in constraint. Mirrors {@link applyRequiredLabels}: composes with any
 * existing `project` clause (e.g. an `excludeProjects` `nin`) by moving both
 * into `where.and`. No-op when there is no required project.
 */
export function applyRequiredProject(
  where: Record<string, unknown>,
  requireProject: string | undefined,
): void {
  if (!requireProject) return;
  const clause = { project: { name: { in: [requireProject] } } };
  const existing = where.project as Record<string, unknown> | undefined;
  if (existing === undefined) {
    const and = where.and as Record<string, unknown>[] | undefined;
    if (and !== undefined) and.push(clause);
    else where.project = clause.project;
    return;
  }
  const and = (where.and as Record<string, unknown>[] | undefined) ?? [];
  and.push({ project: existing }, clause);
  delete where.project;
  where.and = and;
}

/**
 * AND the global filter's negated label / project clauses onto a `where` that is
 * already assembled (used by the mention scan, whose top-level shape is an `or`
 * of indicator branches — `buildIssueFilter` instead folds these into its own
 * exclude list). No-op when there is nothing to exclude.
 */
export function applyGlobalExcludes(
  where: Record<string, unknown>,
  excludeLabels: string[] | undefined,
  excludeProjects: string[] | undefined,
): void {
  if (excludeLabels && excludeLabels.length > 0) {
    const and = (where.and as Record<string, unknown>[] | undefined) ?? [];
    and.push({ labels: { every: { name: { nin: excludeLabels } } } });
    where.and = and;
  }
  if (excludeProjects && excludeProjects.length > 0) {
    const and = (where.and as Record<string, unknown>[] | undefined) ?? [];
    and.push({ project: { name: { nin: excludeProjects } } });
    where.and = and;
  }
}

export function buildIssueFilter(spec: LinearFilterSpec): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (spec.team) where.team = { key: { eq: spec.team } };
  if (spec.anyAssignee || spec.assignee === "any") {
    // no assignee constraint — fetch regardless of who it's assigned to
  } else if (spec.assignee === "unassigned") {
    where.assignee = { null: true };
  } else if (spec.assignee === "me") {
    where.assignee = { isMe: { eq: true } };
  } else if (spec.assignee?.includes("@")) {
    where.assignee = { email: { eq: spec.assignee } };
  } else if (spec.assignee) {
    where.assignee = { id: { eq: spec.assignee } };
  } else {
    // Default: unassigned only — the agent never grabs work assigned to a human.
    where.assignee = { null: true };
  }

  // RLF-208: top-level `number` filter narrows the query to specific tickets.
  // Linear ANDs `number` with the rest of `where`, so it composes cleanly with
  // both the include branches and the open-state default below.
  if (spec.numbers && spec.numbers.length > 0) {
    where.number = { in: spec.numbers };
  }

  // Negated include markers (e.g. `label: !blocked`) mean "must NOT match", so
  // they behave exactly like excludes — split them out and fold them into the
  // exclude list below. Only positive markers drive the any-of include branches.
  const incAll = spec.include ?? [];
  const inc = incAll.filter((m) => !isNegatedMarker(m));
  const negatedInc = incAll.filter(isNegatedMarker);

  let pinnedStatus = false;
  if (inc.length > 0) {
    const { statuses, labels, attachmentSubtitles, projects } = partition(inc);
    pinnedStatus = statuses.length > 0;
    const branches: Record<string, unknown>[] = [];
    if (statuses.length > 0) branches.push({ state: { name: { in: statuses } } });
    if (labels.length > 0) branches.push({ labels: { some: { name: { in: labels } } } });
    if (attachmentSubtitles.length > 0) {
      branches.push({
        attachments: {
          some: {
            title: { eq: RALPHY_ATTACHMENT_TITLE_FILTER },
            subtitle: { in: attachmentSubtitles },
          },
        },
      });
    }
    if (projects.length > 0) branches.push({ project: { name: { in: projects } } });
    for (const b of branches) Object.assign(where, b);
  }
  // Open-state default: unless the include explicitly pins a positive status,
  // constrain to open work (unstarted/started/backlog). Without this, a label-
  // or project-only bucket (e.g. `auto-merge`) drags in Done / Canceled tickets
  // that need no work — they surface in `agent list` and waste an agent pickup.
  if (!pinnedStatus) {
    where.state = { type: { in: ["unstarted", "started", "backlog"] } };
  }

  // Excludes = explicit `spec.exclude` + negated include markers + the global
  // filter's negated label/project clauses (`excludeLabels`/`excludeProjects`).
  const exc: Marker[] = [
    ...(spec.exclude ?? []),
    ...negatedInc,
    ...(spec.excludeLabels ?? []).map((value): Marker => ({ type: "label", value })),
    ...(spec.excludeProjects ?? []).map((value): Marker => ({ type: "project", value })),
  ];
  if (exc.length > 0) {
    const {
      statuses,
      labels,
      attachmentSubtitles: excludedSubtitles,
      projects: excludedProjects,
    } = partition(exc);
    if (excludedProjects.length > 0) {
      const current = where.project as Record<string, unknown> | undefined;
      const noProject = { project: { name: { nin: excludedProjects } } };
      if (current === undefined) Object.assign(where, noProject);
      else {
        const existingAnd = (where.and as Record<string, unknown>[] | undefined) ?? [];
        where.and = [...existingAnd, { project: current }, noProject];
        delete where.project;
      }
    }
    if (excludedSubtitles.length > 0) {
      const existingAnd = (where.and as Record<string, unknown>[] | undefined) ?? [];
      where.and = [
        ...existingAnd,
        {
          attachments: {
            every: {
              or: [
                { title: { neq: RALPHY_ATTACHMENT_TITLE_FILTER } },
                { subtitle: { nin: excludedSubtitles } },
              ],
            },
          },
        },
      ];
    }
    if (statuses.length > 0) {
      const current = where.state as Record<string, unknown> | undefined;
      const noStatus = { state: { name: { nin: statuses } } };
      if (current === undefined) Object.assign(where, noStatus);
      else where.and = [{ state: current }, noStatus];
    }
    if (labels.length > 0) {
      const includeLabels = where.labels as Record<string, unknown> | undefined;
      const excludeLabels = { every: { name: { nin: labels } } };
      if (includeLabels === undefined) {
        where.labels = excludeLabels;
      } else {
        const existingAnd = (where.and as Record<string, unknown>[] | undefined) ?? [];
        where.and = [...existingAnd, { labels: includeLabels }, { labels: excludeLabels }];
        delete where.labels;
      }
    }
  }

  applyRequiredLabels(where, spec.requireAllLabels);
  applyRequiredProject(where, spec.requireProject);

  return where;
}

export function clauseFromMarkers(markers: Marker[]): Record<string, unknown> | null {
  if (markers.length === 0) return null;
  const { statuses, labels, attachmentSubtitles, projects } = partition(
    markers.filter((m) => !isNegatedMarker(m)),
  );
  const parts: Record<string, unknown> = {};
  if (statuses.length > 0) parts.state = { name: { in: statuses } };
  if (labels.length > 0) parts.labels = { some: { name: { in: labels } } };
  if (attachmentSubtitles.length > 0) {
    parts.attachments = {
      some: {
        title: { eq: RALPHY_ATTACHMENT_TITLE_FILTER },
        subtitle: { in: attachmentSubtitles },
      },
    };
  }
  if (projects.length > 0) parts.project = { name: { in: projects } };
  // Negated markers become must-not sub-clauses ANDed alongside the positive
  // ones (kept in `and` so a positive and negated marker of the same kind don't
  // collide on a single top-level key).
  const negated = partition(markers.filter(isNegatedMarker));
  const negClauses: Record<string, unknown>[] = [];
  if (negated.statuses.length > 0) negClauses.push({ state: { name: { nin: negated.statuses } } });
  if (negated.labels.length > 0)
    negClauses.push({ labels: { every: { name: { nin: negated.labels } } } });
  if (negated.projects.length > 0)
    negClauses.push({ project: { name: { nin: negated.projects } } });
  if (negClauses.length > 0) parts.and = negClauses;
  return Object.keys(parts).length > 0 ? parts : null;
}

const BRANCH_LABEL_PREFIX = "ralph:branch:";

export function baseBranchFromLabels(labels: string[]): string | undefined {
  for (const label of labels) {
    if (label.toLowerCase().startsWith(BRANCH_LABEL_PREFIX)) {
      const value = label.slice(BRANCH_LABEL_PREFIX.length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

export function issueMatchesGetIndicator(
  issue: Pick<TrackedIssue, "labels" | "state" | "project"> & {
    comments?: { body: string; user?: { name: string } | null }[];
  },
  indicator: GetIndicator | undefined,
): boolean {
  if (!indicator || indicator.filter.length === 0) return false;
  const labels = new Set(issue.labels.map((l) => l.toLowerCase()));
  const stateName = issue.state.name.toLowerCase();
  const projectName = issue.project?.name.toLowerCase() ?? null;
  const baseMatch = (m: Marker): boolean => {
    if (m.type === "label") return labels.has(m.value.toLowerCase());
    if (m.type === "status") return stateName === m.value.toLowerCase();
    if (m.type === "project") {
      if (projectName === null) return false;
      return projectName === m.value.toLowerCase();
    }
    if (m.type === "comment") {
      if (!m.value) return false;
      const comments = issue.comments;
      if (!comments || comments.length === 0) return false;
      const needle = m.value.toLowerCase();
      return comments.some((c) => !isRalphComment(c.body) && c.body.toLowerCase().includes(needle));
    }
    return false;
  };
  // `negate: true` inverts the clause: the issue matches when it does NOT
  // satisfy the marker (a label it must not carry, a status it must not be in).
  return indicator.filter.some((m) => (isNegatedMarker(m) ? !baseMatch(m) : baseMatch(m)));
}
