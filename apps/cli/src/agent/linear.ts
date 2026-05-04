export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  labels: string[];
}

export interface LinearFilter {
  team?: string | undefined;
  assignee?: string | undefined;
  statuses?: string[] | undefined;
  /** Match any-of these label names (legacy `label` config maps to a 1-element array). */
  labels?: string[] | undefined;
}

const OPEN_STATE_TYPES = ["unstarted", "started", "backlog"] as const;

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
}

export async function fetchOpenIssues(
  apiKey: string,
  filter: LinearFilter,
): Promise<LinearIssue[]> {
  const where: Record<string, unknown> = {};
  if (filter.team) where.team = { key: { eq: filter.team } };
  if (filter.assignee) {
    if (filter.assignee === "me") {
      where.assignee = { isMe: { eq: true } };
    } else if (filter.assignee.includes("@")) {
      where.assignee = { email: { eq: filter.assignee } };
    } else {
      where.assignee = { id: { eq: filter.assignee } };
    }
  }
  if (filter.statuses && filter.statuses.length > 0) {
    where.state = { name: { in: filter.statuses } };
  } else {
    where.state = { type: { in: [...OPEN_STATE_TYPES] } };
  }
  if (filter.labels && filter.labels.length > 0) {
    where.labels = { some: { name: { in: filter.labels } } };
  }

  const query = `query Issues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url
        state { name type }
        assignee { id email name }
        labels { nodes { name } }
      }
    }
  }`;

  const data = await linearRequest<{ issues: { nodes: LinearNode[] } }>(apiKey, query, {
    filter: where,
  });

  return data.issues.nodes.map((n) => ({
    id: n.id,
    identifier: n.identifier,
    title: n.title,
    description: n.description,
    url: n.url,
    state: n.state,
    assignee: n.assignee,
    labels: n.labels.nodes.map((l) => l.name),
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
