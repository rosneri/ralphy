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
  label?: string | undefined;
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

interface LinearResponse {
  data?: { issues: { nodes: LinearNode[] } };
  errors?: { message: string }[];
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
  if (filter.label) where.labels = { some: { name: { eq: filter.label } } };

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

  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables: { filter: where } }),
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

  const json = (await res.json()) as LinearResponse;
  if (json.errors?.length) {
    const err = new Error("Linear API returned errors") as Error & {
      messages?: string[];
    };
    err.messages = json.errors.map((e) => e.message);
    throw err;
  }
  if (!json.data) return [];

  return json.data.issues.nodes.map((n) => ({
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
