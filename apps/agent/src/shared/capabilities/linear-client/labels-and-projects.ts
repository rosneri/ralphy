import { linearRequest } from "./request";

interface IssueLabel {
  id: string;
  name: string;
}

interface IssueLabelNode {
  id: string;
  name: string;
  parent: { name: string } | null;
}

export async function fetchIssueLabels(apiKey: string, teamKey: string): Promise<IssueLabel[]> {
  const teamQuery = `query Labels($team: String!) {
    issueLabels(filter: { team: { key: { eq: $team } } }, first: 250) {
      nodes { id name parent { name } }
    }
  }`;
  const workspaceQuery = `query WorkspaceLabels {
    issueLabels(filter: { team: { null: true } }, first: 250) {
      nodes { id name parent { name } }
    }
  }`;
  const [teamData, workspaceData] = await Promise.all([
    linearRequest<{ issueLabels: { nodes: IssueLabelNode[] } }>(apiKey, teamQuery, {
      team: teamKey,
    }),
    linearRequest<{ issueLabels: { nodes: IssueLabelNode[] } }>(apiKey, workspaceQuery, {}).catch(
      () => ({ issueLabels: { nodes: [] as IssueLabelNode[] } }),
    ),
  ]);
  const seen = new Map<string, IssueLabel>();
  for (const l of workspaceData.issueLabels.nodes) {
    const name = l.parent ? `${l.parent.name}:${l.name}` : l.name;
    seen.set(name.toLowerCase(), { id: l.id, name });
  }
  for (const l of teamData.issueLabels.nodes) {
    const name = l.parent ? `${l.parent.name}:${l.name}` : l.name;
    seen.set(name.toLowerCase(), { id: l.id, name });
  }
  return [...seen.values()];
}

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

export async function createIssueLabel(
  apiKey: string,
  teamId: string,
  name: string,
  parentId?: string,
): Promise<string | null> {
  const mutation = parentId
    ? `mutation CreateLabel($teamId: String!, $name: String!, $parentId: String!) {
    issueLabelCreate(input: { teamId: $teamId, name: $name, parentId: $parentId }) {
      success
      issueLabel { id }
    }
  }`
    : `mutation CreateLabel($teamId: String!, $name: String!) {
    issueLabelCreate(input: { teamId: $teamId, name: $name }) {
      success
      issueLabel { id }
    }
  }`;
  const data = await linearRequest<{
    issueLabelCreate: { success: boolean; issueLabel: { id: string } | null };
  }>(apiKey, mutation, parentId ? { teamId, name, parentId } : { teamId, name });
  return data.issueLabelCreate.issueLabel?.id ?? null;
}

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

export async function fetchProjectIdByName(apiKey: string, name: string): Promise<string | null> {
  const query = `query ProjectId($name: String!) {
    projects(filter: { name: { eq: $name } }, first: 1) {
      nodes { id }
    }
  }`;
  const data = await linearRequest<{ projects: { nodes: { id: string }[] } }>(apiKey, query, {
    name,
  });
  return data.projects.nodes[0]?.id ?? null;
}

export async function setIssueProject(
  apiKey: string,
  issueId: string,
  projectId: string,
): Promise<void> {
  const mutation = `mutation SetProject($id: String!, $projectId: String!) {
    issueUpdate(id: $id, input: { projectId: $projectId }) { success }
  }`;
  await linearRequest<{ issueUpdate: { success: boolean } }>(apiKey, mutation, {
    id: issueId,
    projectId,
  });
}

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
