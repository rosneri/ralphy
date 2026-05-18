import type { GetIndicator, Marker } from "@ralphy/types";

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
  /** ISO timestamp of issue creation — used as a FIFO tiebreaker in the
   *  coordinator queue so older same-priority work runs first. */
  createdAt: string;
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
  createdAt: string;
  relations: { nodes: { type: string; relatedIssue: { id: string; state: { type: string } } }[] };
}

interface Partitioned {
  statuses: string[];
  labels: string[];
  /** Attachment marker values — matched against the Ralphy attachment
   *  `subtitle` field (the agent always sets `title: "Ralphy"`). */
  attachmentSubtitles: string[];
}

function partition(markers: Marker[]): Partitioned {
  const statuses: string[] = [];
  const labels: string[] = [];
  const attachmentSubtitles: string[] = [];
  for (const m of markers) {
    if (m.type === "status") statuses.push(m.value);
    else if (m.type === "label") labels.push(m.value);
    else attachmentSubtitles.push(m.value);
  }
  return { statuses, labels, attachmentSubtitles };
}

/** Title used on every Ralphy-managed attachment (set in
 *  `upsertRalphyAttachment`). All `type:"attachment"` markers are matched
 *  against the subtitle of an attachment that bears this title. */
const RALPHY_ATTACHMENT_TITLE_FILTER = "Ralphy";

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
    const { statuses, labels, attachmentSubtitles } = partition(inc);
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
    for (const b of branches) Object.assign(where, b);
  } else {
    // Default: open issues only (preserves prior behavior when no
    // indicators are configured at all).
    where.state = { type: { in: ["unstarted", "started", "backlog"] } };
  }

  const exc = spec.exclude ?? [];
  if (exc.length > 0) {
    const { statuses, labels, attachmentSubtitles: excludedSubtitles } = partition(exc);
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
      // Merge with any existing state constraint via `and:`.
      const current = where.state as Record<string, unknown> | undefined;
      const noStatus = { state: { name: { nin: statuses } } };
      if (current === undefined) Object.assign(where, noStatus);
      else where.and = [{ state: current }, noStatus];
    }
    if (labels.length > 0) {
      // Linear silently drops the labels filter when both `some` and `every`
      // are present on the same `labels` object (verified empirically). Combine
      // them through `and:` instead so both constraints actually apply.
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

  return where;
}

/**
 * Candidate set for the `@<handle>` mention scan. Returns every issue
 * for the configured `team` + `assignee` that is not in a cancelled
 * state. Unlike `fetchOpenIssues` (which defaults to
 * unstarted/started/backlog only) this also includes `completed` and
 * `triage`, so mentions are picked up regardless of whether the issue is
 * still Todo, In Progress, or already Done.
 */
export async function fetchMentionScanIssues(
  apiKey: string,
  spec: { team?: string | undefined; assignee?: string | undefined },
): Promise<LinearIssue[]> {
  const where: Record<string, unknown> = {
    state: { type: { in: ["unstarted", "started", "backlog", "triage", "completed"] } },
  };
  if (spec.team) where.team = { key: { eq: spec.team } };
  if (spec.assignee) {
    if (spec.assignee === "me") where.assignee = { isMe: { eq: true } };
    else if (spec.assignee.includes("@")) where.assignee = { email: { eq: spec.assignee } };
    else where.assignee = { id: { eq: spec.assignee } };
  }

  const query = `query MentionScanIssues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority createdAt
        state { name type }
        assignee { id email name }
        labels { nodes { name } }
        relations(first: 50) {
          nodes { type relatedIssue { id state { type } } }
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
    createdAt: n.createdAt ?? "",
    blockedByIds: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.id),
  }));
}

export async function fetchOpenIssues(
  apiKey: string,
  spec: LinearFilterSpec,
): Promise<LinearIssue[]> {
  const where = buildIssueFilter(spec);

  const query = `query Issues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority createdAt
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
    createdAt: n.createdAt ?? "",
    blockedByIds: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.id),
  }));
}

interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string }[];
}

/** Test seam: override `sleep` to make retry backoff instant in unit tests.
 *  Defaults to `Bun.sleep`. Keep the public `linearRequest` signature stable. */
export const linearRequestInternals: { sleep: (ms: number) => Promise<void> } = {
  sleep: (ms: number) => Bun.sleep(ms),
};

const MAX_LINEAR_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 2000;

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** Parse a `Retry-After` header value (seconds or HTTP-date) into ms.
 *  Returns undefined when missing/unparsable. Caller clamps. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) return Math.max(0, asNum * 1000);
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function backoffMs(attempt: number): number {
  const base = 250 * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

/** Case-insensitive substring check for Linear's `Rate limit exceeded`
 *  marker. Linear returns rate-limit signals inconsistently — sometimes as
 *  HTTP 429, sometimes as HTTP 400 with the phrase in the body — so callers
 *  rely on both signals. */
function isRateLimitedBody(body: unknown): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  return body.toLowerCase().includes("rate limit exceeded");
}

/** Returns true when an error from `linearRequest` was marked rate-limited
 *  (either HTTP 429 or a body containing "Rate limit exceeded"). */
export function isRateLimitedError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  return (err as { rateLimited?: boolean }).rateLimited === true;
}

/** Render a Linear API error in a structured form: status + truncated body
 *  for HTTP failures, GraphQL `messages` when present, falling back to
 *  `err.message` / `String(err)` for anything else. Exported so wire.ts can
 *  use it at every mention-scan / Linear catch site. */
export function formatLinearError(err: unknown): string {
  if (err === null || err === undefined) return String(err);
  if (typeof err !== "object") return String(err);
  const e = err as {
    status?: number;
    body?: string;
    messages?: string[];
    message?: string;
    rateLimited?: boolean;
  };
  const parts: string[] = [];
  if (e.rateLimited) parts.push("rate limited");
  if (typeof e.status === "number") parts.push(`HTTP ${e.status}`);
  if (Array.isArray(e.messages) && e.messages.length > 0) {
    parts.push(`graphql: ${e.messages.join("; ")}`);
  }
  if (typeof e.body === "string" && e.body.length > 0 && !e.rateLimited) {
    const truncated = e.body.length > 200 ? `${e.body.slice(0, 200)}…` : e.body;
    parts.push(`body: ${truncated}`);
  }
  if (parts.length === 0) {
    if (typeof e.message === "string" && e.message) return e.message;
    return String(err);
  }
  if (typeof e.message === "string" && e.message && !e.rateLimited) parts.unshift(e.message);
  return parts.join(" — ");
}

async function linearRequest<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let lastHttpError: (Error & { status?: number; body?: string; messages?: string[] }) | undefined;

  for (let attempt = 1; attempt <= MAX_LINEAR_ATTEMPTS; attempt++) {
    const res = await fetch(LINEAR_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      const err = new Error("Linear API request failed") as Error & {
        status?: number;
        body?: string;
        rateLimited?: boolean;
      };
      err.status = res.status;
      err.body = await res.text();
      if (res.status === 429 || isRateLimitedBody(err.body)) {
        err.rateLimited = true;
        throw err;
      }
      lastHttpError = err;
      if (isRetryableStatus(res.status) && attempt < MAX_LINEAR_ATTEMPTS) {
        const ra = parseRetryAfter(res.headers.get("Retry-After"));
        const waitMs = Math.min(ra ?? backoffMs(attempt), MAX_RETRY_AFTER_MS);
        await linearRequestInternals.sleep(waitMs);
        continue;
      }
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
  // Loop only exits via `return` on success or `throw` on non-retryable.
  // Retryable exhaustion falls out here.
  throw lastHttpError ?? new Error("Linear API request failed");
}

/** Add a reaction (Linear `reactionCreate` mutation) to a comment.
 *  Best-effort acknowledgement that Ralphy has seen a mention. Linear
 *  treats the (user, comment, emoji) tuple as idempotent, so re-running
 *  on the same comment is a no-op. */
export async function addReactionToComment(
  apiKey: string,
  commentId: string,
  emoji: string,
): Promise<void> {
  const mutation = `mutation Reaction($commentId: String!, $emoji: String!) {
    reactionCreate(input: { commentId: $commentId, emoji: $emoji }) { success }
  }`;
  await linearRequest<{ reactionCreate: { success: boolean } }>(apiKey, mutation, {
    commentId,
    emoji,
  });
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

/** Create a comment and return its id. Used by comment-sync to persist the
 *  comment id for later in-place updates. */
export async function createIssueComment(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<string> {
  const mutation = `mutation Comment($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
      comment { id }
    }
  }`;
  const data = await linearRequest<{
    commentCreate: { success: boolean; comment: { id: string } | null };
  }>(apiKey, mutation, { issueId, body });
  const id = data.commentCreate.comment?.id;
  if (!id) throw new Error("commentCreate returned no comment id");
  return id;
}

/** Edit an existing comment in place via Linear's `commentUpdate` mutation. */
export async function updateIssueComment(
  apiKey: string,
  commentId: string,
  body: string,
): Promise<void> {
  const mutation = `mutation UpdateComment($id: String!, $body: String!) {
    commentUpdate(id: $id, input: { body: $body }) { success }
  }`;
  await linearRequest<{ commentUpdate: { success: boolean } }>(apiKey, mutation, {
    id: commentId,
    body,
  });
}

/** Delete a comment via Linear's `commentDelete` mutation. */
export async function deleteIssueComment(apiKey: string, commentId: string): Promise<void> {
  const mutation = `mutation DeleteComment($id: String!) {
    commentDelete(id: $id) { success }
  }`;
  await linearRequest<{ commentDelete: { success: boolean } }>(apiKey, mutation, {
    id: commentId,
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

interface LinearAttachment {
  id: string;
  url: string;
  sourceType: string | null;
  title: string | null;
}

/** Fixed title used for the ralphy status attachment so upserts can find it. */
const RALPHY_ATTACHMENT_TITLE = "Ralphy";

/** Create a new Ralphy status attachment on an issue. The `subtitle` reflects
 *  the current lifecycle phase (e.g. "In Progress", "Done", "Error"). Returns
 *  the id of the newly created attachment. */
export async function createRalphyAttachment(
  apiKey: string,
  issueId: string,
  issueUrl: string,
  subtitle: string,
): Promise<string> {
  const mutation = `mutation CreateAttachment(
    $issueId: String!, $url: String!, $title: String!, $subtitle: String!
  ) {
    attachmentCreate(input: { issueId: $issueId, url: $url, title: $title, subtitle: $subtitle }) {
      success
      attachment { id }
    }
  }`;
  const data = await linearRequest<{
    attachmentCreate: { success: boolean; attachment: { id: string } | null };
  }>(apiKey, mutation, {
    issueId,
    url: issueUrl,
    title: RALPHY_ATTACHMENT_TITLE,
    subtitle,
  });
  const attachmentId = data.attachmentCreate.attachment?.id;
  if (!attachmentId) throw new Error("attachmentCreate returned no attachment id");
  return attachmentId;
}

/** Update the subtitle of an existing attachment. */
export async function updateAttachmentSubtitle(
  apiKey: string,
  attachmentId: string,
  subtitle: string,
): Promise<void> {
  const mutation = `mutation UpdateAttachment($id: String!, $subtitle: String!) {
    attachmentUpdate(id: $id, input: { subtitle: $subtitle }) { success }
  }`;
  await linearRequest<{ attachmentUpdate: { success: boolean } }>(apiKey, mutation, {
    id: attachmentId,
    subtitle,
  });
}

/** Upsert the Ralphy status attachment on an issue: find the existing one by
 *  title and update its subtitle, or create a new one when none exists. The
 *  same attachment entry is reused across all lifecycle transitions so the
 *  issue stays tidy — one status row, always up-to-date. */
export async function upsertRalphyAttachment(
  apiKey: string,
  issueId: string,
  issueUrl: string,
  subtitle: string,
): Promise<void> {
  const attachments = await fetchIssueAttachments(apiKey, issueId);
  const existing = attachments.find((a) => a.title === RALPHY_ATTACHMENT_TITLE);
  if (existing) {
    await updateAttachmentSubtitle(apiKey, existing.id, subtitle);
  } else {
    await createRalphyAttachment(apiKey, issueId, issueUrl, subtitle);
  }
}

/** Fetch attachments on an issue. Linear's GitHub integration auto-creates
 *  attachments pointing at any PR that references the Linear identifier
 *  in its title/body/branch, so this is the canonical way to find a
 *  ralph-managed PR — more reliable than a GitHub-side branch lookup that
 *  can drift after a title edit. Ordered newest-first by Linear. */
export async function fetchIssueAttachments(
  apiKey: string,
  issueId: string,
): Promise<LinearAttachment[]> {
  const query = `query IssueAttachments($id: String!) {
    issue(id: $id) {
      attachments(first: 25) {
        nodes { id url sourceType title }
      }
    }
  }`;
  const data = await linearRequest<{
    issue: { attachments?: { nodes?: LinearAttachment[] } } | null;
  }>(apiKey, query, { id: issueId });
  return data.issue?.attachments?.nodes ?? [];
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
  // Two queries — Linear separates team-scoped and workspace-scoped
  // labels. A label like `ralph:conflict` can exist at either level,
  // and the team-only fetch used to miss workspace-level labels, which
  // triggered a creation attempt that Linear then rejected. Merge both
  // sets, team labels winning on conflict (more specific).
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

/** Create a label in a team. Pass `parentId` to nest it under a group label. Returns the new label id, or null on failure. */
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

const BRANCH_LABEL_PREFIX = "ralph:branch:";

/** Extract the per-issue PR base branch from a `ralph:branch:<name>` label.
 *  Returns the suffix (trimmed) when present, otherwise undefined. The
 *  prefix match is case-insensitive but the suffix is returned verbatim so
 *  git refs keep their original casing. */
export function baseBranchFromLabels(labels: string[]): string | undefined {
  for (const label of labels) {
    if (label.toLowerCase().startsWith(BRANCH_LABEL_PREFIX)) {
      const value = label.slice(BRANCH_LABEL_PREFIX.length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

/** Does an already-fetched issue match a get-indicator? Used to decide
 *  per-issue opt-ins (e.g. auto-merge) without re-querying Linear. */
export function issueMatchesGetIndicator(
  issue: Pick<LinearIssue, "labels" | "state">,
  indicator: GetIndicator | undefined,
): boolean {
  if (!indicator || indicator.filter.length === 0) return false;
  const labels = new Set(issue.labels.map((l) => l.toLowerCase()));
  const stateName = issue.state.name.toLowerCase();
  return indicator.filter.some((m) => {
    if (m.type === "label") return labels.has(m.value.toLowerCase());
    if (m.type === "status") return stateName === m.value.toLowerCase();
    // attachment markers can only be verified via a separate API call
    // (LinearIssue's pick doesn't carry attachments). Callers that need
    // attachment-based matching should query attachments themselves.
    return false;
  });
}

/** Create a brand-new Linear issue. Used by the baseline gate to file a
 *  ticket for a broken trunk. Returns the new issue's id + identifier. */
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

/** Replace an issue's description body. Used by the baseline gate to refresh
 *  the failing-command output when the fingerprint changes. */
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

/** Find the most recent open (non-completed/cancelled) issue carrying the
 *  given label in the given team. Returns null when none exists. */
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
