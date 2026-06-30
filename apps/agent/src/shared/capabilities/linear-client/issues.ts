import type { GetIndicator, SetIndicator } from "@ralphy/types";
import { linearRequest } from "./request";
import {
  buildIssueFilter,
  clauseFromMarkers,
  applyRequiredLabels,
  applyRequiredProject,
  applyGlobalExcludes,
  type LinearFilterSpec,
} from "./filters";
import { markersOf } from "@ralphy/types";
import type { TrackedComment, TrackedIssue } from "@ralphy/tracker";

interface LinearNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  project: { id: string; name: string; priority?: number } | null;
  projectMilestone: {
    id: string;
    name: string;
    sortOrder: number;
    targetDate: string | null;
  } | null;
  labels: { nodes: { name: string }[] };
  priority: number;
  createdAt: string;
  inverseRelations: {
    nodes: InverseRelationNode[];
  };
  comments?: { nodes: TrackedComment[] };
}

/** Blocker states Linear treats as resolved — pruned from `blocked_by`. */
const DONE_BLOCKER_STATE_TYPES = new Set(["completed", "cancelled"]);

/**
 * One inverse-relation node: a stored relation that points *at* this issue. For
 * a `blocks` relation `A → B`, querying B's `inverseRelations` yields this node
 * with `issue` = A — i.e. A is B's blocker.
 */
interface InverseRelationNode {
  type: string;
  issue: { id: string; identifier: string; state: { type: string } };
}

/**
 * Open blockers (`blocked_by`) of an issue, derived from Linear's
 * `inverseRelations`.
 *
 * Linear has **no `blocked_by` relation type**: "B is blocked by A" is stored as
 * a single `blocks` relation `A → B`. From B's side that link surfaces *only* in
 * `inverseRelations` (`type === "blocks"`, `issue` = the blocker A) — it never
 * appears in `B.relations`. Querying `relations` for a `"blocked_by"` type (as
 * this module used to) therefore matched nothing and every blocked ticket ran.
 * Completed/cancelled blockers are pruned as resolved.
 */
function openBlockersFromInverse(nodes: InverseRelationNode[] | undefined): BlockerRef[] {
  return (nodes ?? [])
    .filter((r) => r.type === "blocks" && !DONE_BLOCKER_STATE_TYPES.has(r.issue.state.type))
    .map((r) => ({ id: r.issue.id, identifier: r.issue.identifier }));
}

/** Map a node's `project` to the `TrackedIssue.project` shape, preserving the
 *  optional `priority` and leaving it off when absent. */
function mapNodeProject(node: LinearNode): TrackedIssue["project"] {
  if (!node.project) return null;
  return {
    id: node.project.id,
    name: node.project.name,
    ...(node.project.priority !== undefined && node.project.priority !== null
      ? { priority: node.project.priority }
      : {}),
  };
}

/** Map a node's `projectMilestone` to the `TrackedIssue.milestone` shape,
 *  returning undefined when the issue has no milestone. */
function mapNodeMilestone(node: LinearNode): TrackedIssue["milestone"] {
  const m = node.projectMilestone;
  if (!m) return undefined;
  return {
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
    ...(m.targetDate != null ? { targetDate: m.targetDate } : {}),
  };
}

/** Spread `{ milestone }` only when the node has one. Typed so the optional
 *  `milestone` field never receives `undefined` (exactOptionalPropertyTypes). */
function milestoneSpread(
  node: LinearNode,
): { milestone: NonNullable<TrackedIssue["milestone"]> } | Record<string, never> {
  const m = mapNodeMilestone(node);
  return m ? { milestone: m } : {};
}

export async function fetchMentionScanIssues(
  apiKey: string,
  spec: {
    team?: string | undefined;
    assignee?: string | undefined;
    anyAssignee?: boolean | undefined;
    /** RLF-208: when non-empty, constrain the scan to these ticket numbers. */
    numbers?: number[] | undefined;
    /** Global `linear.filter` constraints (see {@link LinearFilterSpec}). */
    requireAllLabels?: string[] | undefined;
    excludeLabels?: string[] | undefined;
    requireProject?: string | undefined;
    excludeProjects?: string[] | undefined;
    indicators: {
      getTodo?: GetIndicator | undefined;
      getInProgress?: GetIndicator | undefined;
      setDone?: SetIndicator | undefined;
    };
  },
): Promise<TrackedIssue[]> {
  const branches: Record<string, unknown>[] = [];
  const { getTodo, getInProgress, setDone } = spec.indicators;
  for (const ind of [getTodo, getInProgress]) {
    if (!ind) continue;
    const c = clauseFromMarkers(ind.filter);
    if (c) branches.push(c);
  }
  if (setDone) {
    const c = clauseFromMarkers(markersOf(setDone));
    if (c) branches.push(c);
  }
  if (branches.length === 0) return [];

  const where: Record<string, unknown> =
    branches.length === 1 ? { ...branches[0] } : { or: branches };
  if (spec.team) where.team = { key: { eq: spec.team } };
  if (spec.anyAssignee || spec.assignee === "any") {
    // no assignee constraint — scan regardless of who it's assigned to
  } else if (spec.assignee) {
    if (spec.assignee === "me") where.assignee = { isMe: { eq: true } };
    else if (spec.assignee === "unassigned") where.assignee = { null: true };
    else if (spec.assignee.includes("@")) where.assignee = { email: { eq: spec.assignee } };
    else where.assignee = { id: { eq: spec.assignee } };
  }
  if (spec.numbers && spec.numbers.length > 0) {
    where.number = { in: spec.numbers };
  }
  applyRequiredLabels(where, spec.requireAllLabels);
  applyRequiredProject(where, spec.requireProject);
  applyGlobalExcludes(where, spec.excludeLabels, spec.excludeProjects);

  const query = `query MentionScanIssues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority createdAt
        state { name type }
        assignee { id email name }
        project { id name priority }
        projectMilestone { id name sortOrder targetDate }
        labels { nodes { name } }
        inverseRelations(first: 50) {
          nodes { type issue { id identifier state { type } } }
        }
        comments(first: 50) {
          nodes { id body createdAt user { name email } }
        }
      }
    }
  }`;

  const data = await linearRequest<{ issues: { nodes: LinearNode[] } }>(apiKey, query, {
    filter: where,
  });

  return data.issues.nodes.map((n) => {
    const blockers = openBlockersFromInverse(n.inverseRelations?.nodes);
    return {
      id: n.id,
      identifier: n.identifier,
      title: n.title,
      description: n.description,
      url: n.url,
      state: n.state,
      assignee: n.assignee,
      project: mapNodeProject(n),
      ...milestoneSpread(n),
      labels: n.labels.nodes.map((l) => l.name),
      priority: n.priority,
      createdAt: n.createdAt ?? "",
      blockedByIds: blockers.map((b) => b.id),
      blockedByIdentifiers: blockers.map((b) => b.identifier),
      comments: n.comments?.nodes ?? [],
    };
  });
}

export async function fetchOpenIssues(
  apiKey: string,
  spec: LinearFilterSpec,
  options?: { includeComments?: boolean },
): Promise<TrackedIssue[]> {
  const where = buildIssueFilter(spec);
  const includeComments = options?.includeComments === true;

  const commentsSlice = includeComments
    ? `comments(first: 50) {
          nodes { id body createdAt user { name email } }
        }`
    : "";

  const query = `query Issues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority createdAt
        state { name type }
        assignee { id email name }
        project { id name priority }
        projectMilestone { id name sortOrder targetDate }
        labels { nodes { name } }
        inverseRelations(first: 50) {
          nodes {
            type
            issue { id identifier state { type } }
          }
        }
        ${commentsSlice}
      }
    }
  }`;

  const data = await linearRequest<{ issues: { nodes: LinearNode[] } }>(apiKey, query, {
    filter: where,
  });

  return data.issues.nodes.map((n) => {
    const blockers = openBlockersFromInverse(n.inverseRelations?.nodes);
    return {
      id: n.id,
      identifier: n.identifier,
      title: n.title,
      description: n.description,
      url: n.url,
      state: n.state,
      assignee: n.assignee,
      project: mapNodeProject(n),
      ...milestoneSpread(n),
      labels: n.labels.nodes.map((l) => l.name),
      priority: n.priority,
      createdAt: n.createdAt ?? "",
      blockedByIds: blockers.map((b) => b.id),
      blockedByIdentifiers: blockers.map((b) => b.identifier),
      ...(includeComments ? { comments: n.comments?.nodes ?? [] } : {}),
    };
  });
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

/** A single unresolved blocker of an issue (completed/cancelled pruned out). */
interface BlockerRef {
  id: string;
  identifier: string;
}

/**
 * Fetch the current `blocked_by` relations for a set of issues, freshly from
 * Linear. Returns issueId → unresolved blockers (completed/cancelled states
 * pruned, mirroring {@link fetchOpenIssues}).
 *
 * Used by stacked-PR resolution at PR-create time so a `blocked_by` link added
 * *after* the worker spawned (a common ordering during planning) is still
 * honored, rather than trusting the possibly-stale snapshot captured at spawn.
 */
export async function fetchBlockedByForIssues(
  apiKey: string,
  issueIds: string[],
): Promise<Map<string, BlockerRef[]>> {
  const out = new Map<string, BlockerRef[]>();
  if (issueIds.length === 0) return out;

  const query = `query IssuesBlockedBy($ids: [ID!]!) {
    issues(filter: { id: { in: $ids } }, first: 250) {
      nodes {
        id
        inverseRelations(first: 50) {
          nodes { type issue { id identifier state { type } } }
        }
      }
    }
  }`;
  const data = await linearRequest<{
    issues: {
      nodes: {
        id: string;
        inverseRelations?: { nodes?: InverseRelationNode[] };
      }[];
    };
  }>(apiKey, query, { ids: issueIds });

  for (const node of data.issues.nodes) {
    out.set(node.id, openBlockersFromInverse(node.inverseRelations?.nodes));
  }
  return out;
}

export async function fetchWorkflowStates(
  apiKey: string,
  teamKey: string,
): Promise<WorkflowState[]> {
  const query = `query States($team: String!) {
    workflowStates(filter: { team: { key: { eq: $team } } }, first: 50) {
      nodes { id name type }
    }
  }`;
  const data = await linearRequest<{ workflowStates: { nodes: WorkflowState[] } }>(apiKey, query, {
    team: teamKey,
  });
  return data.workflowStates.nodes;
}

export async function updateIssueState(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<void> {
  const mutation = `mutation Update($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) { success }
  }`;
  await linearRequest<{ issueUpdate: { success: boolean } }>(apiKey, mutation, {
    id: issueId,
    stateId,
  });
}

export async function createIssue(
  apiKey: string,
  input: { teamId: string; title: string; description: string; labelIds?: string[] },
): Promise<{ id: string; identifier: string }> {
  const mutation = `mutation CreateIssue($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier }
    }
  }`;
  const variables: Record<string, unknown> = {
    input: {
      teamId: input.teamId,
      title: input.title,
      description: input.description,
      ...(input.labelIds && input.labelIds.length > 0 ? { labelIds: input.labelIds } : {}),
    },
  };
  const data = await linearRequest<{
    issueCreate: { success: boolean; issue: { id: string; identifier: string } | null };
  }>(apiKey, mutation, variables);
  const issue = data.issueCreate.issue;
  if (!issue) throw new Error("issueCreate returned no issue");
  return issue;
}

export async function updateIssueDescription(
  apiKey: string,
  issueId: string,
  description: string,
): Promise<void> {
  const mutation = `mutation UpdateDesc($id: String!, $description: String!) {
    issueUpdate(id: $id, input: { description: $description }) { success }
  }`;
  await linearRequest<{ issueUpdate: { success: boolean } }>(apiKey, mutation, {
    id: issueId,
    description,
  });
}

export async function findOpenIssueByLabel(
  apiKey: string,
  teamKey: string,
  labelName: string,
): Promise<{ id: string; identifier: string; description: string | null } | null> {
  const query = `query OpenByLabel($team: String!, $label: String!) {
    issues(
      filter: {
        team: { key: { eq: $team } },
        labels: { some: { name: { eq: $label } } },
        state: { type: { in: ["unstarted", "started", "backlog", "triage"] } }
      },
      first: 1,
      orderBy: createdAt
    ) {
      nodes { id identifier description }
    }
  }`;
  const data = await linearRequest<{
    issues: { nodes: { id: string; identifier: string; description: string | null }[] };
  }>(apiKey, query, { team: teamKey, label: labelName });
  return data.issues.nodes[0] ?? null;
}
