import type { Marker } from "@ralphy/types";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  labels: string[];
  /** Linear priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority */
  priority: number;
  /**
   * IDs of issues that block this one and are not yet completed/cancelled.
   * Populated from Linear's "blocked_by" relations.
   */
  blockedByIds: string[];
}

/**
 * Linear query spec used by the agent. `include` is an all-of marker list
 * (issue must match every condition). `exclude` is a none-of marker list
 * (issue must not match any). Empty lists are treated as "no constraint".
 */
export interface LinearFilterSpec {
  team?: string | undefined;
  assignee?: string | undefined;
  include?: Marker[] | undefined;
  exclude?: Marker[] | undefined;
}

const LINEAR_API = "https://api.linear.app/graphql";

interface LinearNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  labels: { nodes: { name: string }[] };
  priority: number;
  relations: { nodes: { type: string; relatedIssue: { id: string; state: { type: string } } }[] };
}

function partition(markers: Marker[]): { statuses: string[]; labels: string[] } {
  const statuses: string[] = [];
  const labels: string[] = [];
  for (const m of markers) {
    if (m.type === "status") statuses.push(m.value);
    else labels.push(m.value);
  }
  return { statuses, labels };
}

/**
 * Build the Linear `IssueFilter` GraphQL variable. `include` is all-of
 * across statuses + labels; `exclude` is none-of across both.
 *
 * Multiple include conditions are ANDed by assigning each directly to
 * `where` (Linear treats top-level fields as implicit AND).
 */
function buildIssueFilter(spec: LinearFilterSpec): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (spec.team) where.team = { key: { eq: spec.team } };
  if (spec.assignee) {
    if (spec.assignee === "me") where.assignee = { isMe: { eq: true } };
    else if (spec.assignee.includes("@")) where.assignee = { email: { eq: spec.assignee } };
    else where.assignee = { id: { eq: spec.assignee } };
  }

  const inc = spec.include ?? [];
  if (inc.length > 0) {
    const { statuses, labels } = partition(inc);
    const branches: Record<string, unknown>[] = [];
    if (statuses.length > 0) branches.push({ state: { name: { in: statuses } } });
    if (labels.length > 0) branches.push({ labels: { some: { name: { in: labels } } } });
    for (const b of branches) Object.assign(where, b);
  } else {
    // Default: open issues only (preserves prior behavior when no
    // indicators are configured at all).
    where.state = { type: { in: ["unstarted", "started", "backlog"] } };
  }

  const exc = spec.exclude ?? [];
  if (exc.length > 0) {
    const { statuses, labels } = partition(exc);
    if (statuses.length > 0) {
      // Merge with any existing state constraint via `and:`.
      const current = where.state as Record<string, unknown> | undefined;
      const noStatus = { state: { name: { nin: statuses } } };
      if (current === undefined) Object.assign(where, noStatus);
      else where.and = [{ state: current }, noStatus];
    }
    if (labels.length > 0) {
      // "every label is not in [...]" — Linear supports `labels.every`.
      where.labels = { ...(where.labels as object | undefined), every: { name: { nin: labels } } };
    }
  }

  return where;
}

export async function fetchOpenIssues(
  apiKey: string,
  spec: LinearFilterSpec,
): Promise<LinearIssue[]> {
  const where = buildIssueFilter(spec);

  const query = `query Issues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority
        state { name type }
        assignee { id email name }
        labels { nodes { name } }
        relations(first: 50) {
          nodes {
            type
            relatedIssue { id state { type } }
          }
        }
      }
    }
  }`;

  const data = await linearRequest<{ issues: { nodes: LinearNode[] } }>(apiKey, query, {
    filter: where,
  });

  const DONE_STATE_TYPES = new Set(["completed", "cancelled"]);
  return data.issues.nodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    description: n.description,
    url: n.url,
    state: n.state,
    assignee: n.assignee,
    labels: n.labels.nodes.map((l) => l.name),
    priority: n.priority,
    blockedByIds: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.id),
  }));
}

interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string }[];
}

async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const err = new Error("Linear API request failed") as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    err.body = await res.text();
    throw err;
  }
  const json = (await res.json()) as GraphQLResult<T>;
  if (json.errors?.length) {
    const err = new Error("Linear API returned errors") as Error & {
      messages?: string[];
    };
    err.messages = json.errors.map((e) => e.message);
    throw err;
  }
  if (!json.data) {
    throw new Error("Linear API returned no data");
  }
  return json.data;
}

export async function addIssueComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<void> {
  const mutation = `mutation Comment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) { success }
  }`;
  await linearRequest<{ commentCreate: { success: boolean } }>(apiKey, mutation, {
    issueId,
    body,
  });
}

interface WorkflowState {
  id: string;
  name: string;
  type: string;
}

export interface LinearComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; email: string | null } | null;
}

export async function fetchIssueComments(
  apiKey: string,
  issueId: string,
): Promise<LinearComment[]> {
  const query = `query Comments($id: String!) {
    issue(id: $id) {
      comments(first: 50) {
        nodes { id body createdAt user { name email } }
      }
    }
  }`;
  const data = await linearRequest<{
    issue: { comments: { nodes: LinearComment[] } } | null;
  }>(apiKey, query, { id: issueId });
  return data.issue?.comments.nodes ?? [];
}

/** Fetch all workflow states for a given team key (e.g. "ENG"). */
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

interface IssueLabel {
  id: string;
  name: string;
}

interface IssueLabelNode {
  id: string;
  name: string;
  parent: { name: string } | null;
}

/** Fetch all issue labels for a given team key.
 *  Namespaced labels (e.g. parent "ralph", name "error") are returned with
 *  a colon-joined key ("ralph:error") so config references match. */
export async function fetchIssueLabels(apiKey: string, teamKey: string): Promise<IssueLabel[]> {
  const query = `query Labels($team: String!) {
    issueLabels(filter: { team: { key: { eq: $team } } }, first: 250) {
      nodes { id name parent { name } }
    }
  }`;
  const data = await linearRequest<{ issueLabels: { nodes: IssueLabelNode[] } }>(apiKey, query, {
    team: teamKey,
  });
  return data.issueLabels.nodes.map((l) => ({
    id: l.id,
    name: l.parent ? `${l.parent.name}:${l.name}` : l.name,
  }));
}

/** Fetch the UUID of a team by its key (e.g. "ENG"). Returns null if not found. */
export async function fetchTeamIdByKey(apiKey: string, teamKey: string): Promise<string | null> {
  const query = `query TeamId($key: String!) {
    teams(filter: { key: { eq: $key } }, first: 1) {
      nodes { id }
    }
  }`;
  const data = await linearRequest<{ teams: { nodes: { id: string }[] } }>(apiKey, query, {
    key: teamKey,
  });
  return data.teams.nodes[0]?.id ?? null;
}

/** Create a label in a team. Returns the new label id, or null on failure. */
export async function createIssueLabel(
  apiKey: string,
  teamId: string,
  name: string,
): Promise<string | null> {
  const mutation = `mutation CreateLabel($teamId: String!, $name: String!) {
    issueLabelCreate(input: { teamId: $teamId, name: $name }) {
      success
      issueLabel { id }
    }
  }`;
  const data = await linearRequest<{
    issueLabelCreate: { success: boolean; issueLabel: { id: string } | null };
  }>(apiKey, mutation, { teamId, name });
  return data.issueLabelCreate.issueLabel?.id ?? null;
}

/** Add a label to an issue. Linear preserves existing labels. */
export async function addLabelToIssue(
  apiKey: string,
  issueId: string,
  labelId: string,
): Promise<void> {
  const mutation = `mutation AddLabel($id: String!, $labelId: String!) {
    issueAddLabel(id: $id, labelId: $labelId) { success }
  }`;
  await linearRequest<{ issueAddLabel: { success: boolean } }>(apiKey, mutation, {
    id: issueId,
    labelId,
  });
}

/** Remove a label from an issue. No-op if the issue does not bear it. */
export async function removeLabelFromIssue(
  apiKey: string,
  issueId: string,
  labelId: string,
): Promise<void> {
  const mutation = `mutation RemoveLabel($id: String!, $labelId: String!) {
    issueRemoveLabel(id: $id, labelId: $labelId) { success }
  }`;
  await linearRequest<{ issueRemoveLabel: { success: boolean } }>(apiKey, mutation, {
    id: issueId,
    labelId,
  });
}
