/**
 * Linear GraphQL client — transport + every Linear operation used by the
 * agent. Moved from `apps/agent/src/agent/linear.ts` as part of the shared
 * capabilities extraction (RLF-93 stage 4).
 *
 * The transport (`linearRequest`) now retries `429 Too Many Requests`
 * responses honoring `Retry-After` (seconds or HTTP-date), clamped to
 * `MAX_RETRY_AFTER_MS`. After exhausted retries, the thrown error still
 * carries `rateLimited: true` so callers can short-circuit via
 * `isRateLimitedError`.
 */

import type { GetIndicator, Marker, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { TrackedComment, TrackedIssue } from "@ralphy/tracker";
import { isRalphComment } from "../utils/ralph-comment";

/**
 * Back-compat alias. The canonical, tracker-neutral shape now lives in
 * `@ralphy/tracker` as {@link TrackedIssue} (RLF-223 M1 — provider seam). Kept
 * so the ~50 files importing `LinearIssue` from the Linear client compile
 * untouched.
 */
export type LinearIssue = TrackedIssue;

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
}

const LINEAR_API = "https://api.linear.app/graphql";

// ---------------------------------------------------------------------------
// Ticket-identifier parsing for the `--ticket` flag (RLF-208)
// ---------------------------------------------------------------------------

export interface ParsedTicketIdentifier {
  /** Uppercased team key (e.g. "RLF"), or null when a bare number was given. */
  teamKey: string | null;
  /** The Linear issue number (e.g. 208). */
  number: number;
}

const TICKET_IDENTIFIER_RE = /^([A-Za-z]+)-(\d+)(?:-.*)?$/;
const TICKET_BARE_NUMBER_RE = /^(\d+)$/;

/**
 * Parse a single ticket identifier token. Accepts the full identifier form
 * (`RLF-208` / `rlf-208`, case-insensitive), a bare number (`208`), and a
 * change-name slug (`rlf-208-some-slug`, whose leading `<team>-<number>` is
 * extracted). Throws a descriptive `Error` on malformed input.
 */
export function parseTicketIdentifier(raw: string): ParsedTicketIdentifier {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("--ticket value cannot be empty");
  }
  const bare = TICKET_BARE_NUMBER_RE.exec(trimmed);
  if (bare) {
    return { teamKey: null, number: Number(bare[1]) };
  }
  const match = TICKET_IDENTIFIER_RE.exec(trimmed);
  if (!match) {
    const err = new Error(
      "--ticket value is not a Linear ticket (expected e.g. RLF-208 or 208)",
    ) as Error & { value?: string };
    err.value = raw;
    throw err;
  }
  return { teamKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}

/**
 * Resolve a list of raw `--ticket` tokens to a deduped set of Linear ticket
 * numbers, validated against the configured `team`.
 *
 * Throws when a full identifier's team key disagrees with `team`
 * (case-insensitive), or when a bare number is given but no `team` is
 * configured. Returns an empty array when `tokens` is empty (no constraint).
 */
export function resolveTicketNumbers(tokens: string[], team: string | undefined): number[] {
  const teamKey = team?.trim() ? team.trim().toUpperCase() : null;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const token of tokens) {
    const { teamKey: parsedTeam, number } = parseTicketIdentifier(token);
    if (parsedTeam !== null) {
      if (teamKey !== null && parsedTeam !== teamKey) {
        const err = new Error("--ticket identifier is not in the configured team") as Error & {
          ticket?: string;
          team?: string | undefined;
        };
        err.ticket = token;
        err.team = team;
        throw err;
      }
    } else if (teamKey === null) {
      const err = new Error(
        "--ticket bare number needs a configured team; pass --linear-team or set linear.team in config",
      ) as Error & { ticket?: string };
      err.ticket = token;
      throw err;
    }
    if (!seen.has(number)) {
      seen.add(number);
      out.push(number);
    }
  }
  return out;
}

/**
 * Render a `--ticket` validation error for the operator: the static `message`
 * plus any attached context (offending ticket / configured team), so the CLI
 * line is both searchable and actionable.
 */
export function formatTicketError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { ticket?: string; team?: string; value?: string };
  const detail = e.ticket ?? e.value;
  const parts: string[] = [];
  if (detail) parts.push(`ticket: ${detail}`);
  if (e.team) parts.push(`configured team: ${e.team}`);
  return parts.length > 0 ? `${e.message} (${parts.join(", ")})` : e.message;
}

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
  relations: {
    nodes: {
      type: string;
      relatedIssue: { id: string; identifier: string; state: { type: string } };
    }[];
  };
  comments?: { nodes: LinearComment[] };
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
function applyRequiredLabels(
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

  const inc = spec.include ?? [];
  if (inc.length > 0) {
    const { statuses, labels, attachmentSubtitles, projects } = partition(inc);
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
  } else {
    where.state = { type: { in: ["unstarted", "started", "backlog"] } };
  }

  const exc = spec.exclude ?? [];
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

  return where;
}

export function clauseFromMarkers(markers: Marker[]): Record<string, unknown> | null {
  if (markers.length === 0) return null;
  const { statuses, labels, attachmentSubtitles, projects } = partition(markers);
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
  return Object.keys(parts).length > 0 ? parts : null;
}

/** Map a node's `project` to the `LinearIssue.project` shape, preserving the
 *  optional `priority` and leaving it off when absent. */
function mapNodeProject(node: LinearNode): LinearIssue["project"] {
  if (!node.project) return null;
  return {
    id: node.project.id,
    name: node.project.name,
    ...(node.project.priority !== undefined && node.project.priority !== null
      ? { priority: node.project.priority }
      : {}),
  };
}

/** Map a node's `projectMilestone` to the `LinearIssue.milestone` shape,
 *  returning undefined when the issue has no milestone. */
function mapNodeMilestone(node: LinearNode): LinearIssue["milestone"] {
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
): { milestone: NonNullable<LinearIssue["milestone"]> } | Record<string, never> {
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
    /** Global `linear.filter` must-have labels (see {@link LinearFilterSpec}). */
    requireAllLabels?: string[] | undefined;
    indicators: {
      getTodo?: GetIndicator | undefined;
      getInProgress?: GetIndicator | undefined;
      setDone?: SetIndicator | undefined;
    };
  },
): Promise<LinearIssue[]> {
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

  const query = `query MentionScanIssues($filter: IssueFilter) {
    issues(filter: $filter, first: 50) {
      nodes {
        id identifier title description url priority createdAt
        state { name type }
        assignee { id email name }
        project { id name priority }
        projectMilestone { id name sortOrder targetDate }
        labels { nodes { name } }
        relations(first: 50) {
          nodes { type relatedIssue { id identifier state { type } } }
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

  const DONE_STATE_TYPES = new Set(["completed", "cancelled"]);
  return data.issues.nodes.map((n) => ({
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
    blockedByIds: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.id),
    blockedByIdentifiers: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.identifier),
    comments: n.comments?.nodes ?? [],
  }));
}

export async function fetchOpenIssues(
  apiKey: string,
  spec: LinearFilterSpec,
  options?: { includeComments?: boolean },
): Promise<LinearIssue[]> {
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
        relations(first: 50) {
          nodes {
            type
            relatedIssue { id identifier state { type } }
          }
        }
        ${commentsSlice}
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
    project: mapNodeProject(n),
    ...milestoneSpread(n),
    labels: n.labels.nodes.map((l) => l.name),
    priority: n.priority,
    createdAt: n.createdAt ?? "",
    blockedByIds: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.id),
    blockedByIdentifiers: (n.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => r.relatedIssue.identifier),
    ...(includeComments ? { comments: n.comments?.nodes ?? [] } : {}),
  }));
}

interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string }[];
}

/** Test seam: override `sleep` to make retry backoff instant in unit tests. */
export const linearRequestInternals: { sleep: (ms: number) => Promise<void> } = {
  sleep: (ms: number) => Bun.sleep(ms),
};

const MAX_LINEAR_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 2000;
const BODY_TRUNCATE_CHARS = 512;

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

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

function isRateLimitedBody(body: unknown): boolean {
  if (typeof body !== "string" || body.length === 0) return false;
  return body.toLowerCase().includes("rate limit exceeded");
}

export function isRateLimitedError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  return (err as { rateLimited?: boolean }).rateLimited === true;
}

/** Render a Linear API error in a structured form: status + truncated body
 *  for HTTP failures, GraphQL `messages` joined by "; " when present,
 *  falling back to `err.message` / `String(err)` for anything else. */
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
    const truncated =
      e.body.length > BODY_TRUNCATE_CHARS ? `${e.body.slice(0, BODY_TRUNCATE_CHARS)}…` : e.body;
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
  let lastHttpError:
    | (Error & { status?: number; body?: string; messages?: string[]; rateLimited?: boolean })
    | undefined;

  for (let attempt = 1; attempt <= MAX_LINEAR_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(LINEAR_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query, variables }),
      });
    } catch (netErr) {
      // Network-level failure (e.g. Bun's "The socket connection was closed
      // unexpectedly" when a keep-alive socket dies) — transient, retry with
      // the same backoff as 5xx.
      lastHttpError = netErr as Error;
      if (attempt < MAX_LINEAR_ATTEMPTS) {
        await linearRequestInternals.sleep(Math.min(backoffMs(attempt), MAX_RETRY_AFTER_MS));
        continue;
      }
      throw netErr;
    }
    if (!res.ok) {
      const err = new Error("Linear API request failed") as Error & {
        status?: number;
        body?: string;
        rateLimited?: boolean;
      };
      err.status = res.status;
      err.body = await res.text();
      const rateLimited = res.status === 429 || isRateLimitedBody(err.body);
      if (rateLimited) err.rateLimited = true;

      const retryable = rateLimited || isRetryableStatus(res.status);
      lastHttpError = err;
      if (retryable && attempt < MAX_LINEAR_ATTEMPTS) {
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
  throw lastHttpError ?? new Error("Linear API request failed");
}

interface LinearFileUpload {
  fileUpload: {
    uploadFile: {
      uploadUrl: string;
      assetUrl: string;
      headers: { key: string; value: string }[];
    } | null;
  } | null;
}

export async function uploadFileToLinear(
  apiKey: string,
  input: { filename: string; contentType: string; bytes: Uint8Array },
): Promise<{ assetUrl: string }> {
  const mutation = `mutation FileUpload($filename: String!, $contentType: String!, $size: Int!) {
    fileUpload(filename: $filename, contentType: $contentType, size: $size) {
      uploadFile { uploadUrl assetUrl headers { key value } }
    }
  }`;
  const data = await linearRequest<LinearFileUpload>(apiKey, mutation, {
    filename: input.filename,
    contentType: input.contentType,
    size: input.bytes.byteLength,
  });
  const up = data.fileUpload?.uploadFile;
  if (!up) throw new Error("fileUpload returned no uploadFile payload");

  const headers: Record<string, string> = { "Content-Type": input.contentType };
  for (const h of up.headers) headers[h.key] = h.value;
  const res = await fetch(up.uploadUrl, {
    method: "PUT",
    headers,
    body: input.bytes as BodyInit,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error("Linear file upload PUT failed") as Error & {
      status?: number;
      body?: string;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { assetUrl: up.assetUrl };
}

export async function createAttachmentForUrl(
  apiKey: string,
  input: { issueId: string; url: string; title: string; subtitle?: string },
): Promise<string> {
  const mutation = `mutation CreateAttachment(
    $issueId: String!, $url: String!, $title: String!, $subtitle: String
  ) {
    attachmentCreate(input: { issueId: $issueId, url: $url, title: $title, subtitle: $subtitle }) {
      success
      attachment { id }
    }
  }`;
  const data = await linearRequest<{
    attachmentCreate: { success: boolean; attachment: { id: string } | null };
  }>(apiKey, mutation, {
    issueId: input.issueId,
    url: input.url,
    title: input.title,
    subtitle: input.subtitle ?? null,
  });
  const id = data.attachmentCreate.attachment?.id;
  if (!id) throw new Error("attachmentCreate returned no attachment id");
  return id;
}

export async function deleteAttachment(apiKey: string, attachmentId: string): Promise<void> {
  const mutation = `mutation DeleteAttachment($id: String!) {
    attachmentDelete(id: $id) { success }
  }`;
  await linearRequest<{ attachmentDelete: { success: boolean } }>(apiKey, mutation, {
    id: attachmentId,
  });
}

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

/** Back-compat alias for {@link TrackedComment} (see {@link LinearIssue}). */
export type LinearComment = TrackedComment;

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

export const RALPHY_ATTACHMENT_TITLE = "Ralphy";

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

export async function upsertRalphyAttachment(
  apiKey: string,
  issueId: string,
  issueUrl: string,
  subtitle: string,
): Promise<void> {
  const attachments = await fetchIssueAttachments(apiKey, issueId, {
    titleFilter: RALPHY_ATTACHMENT_TITLE,
  });
  const existing = attachments[0];
  if (existing) {
    await updateAttachmentSubtitle(apiKey, existing.id, subtitle);
  } else {
    await createRalphyAttachment(apiKey, issueId, issueUrl, subtitle);
  }
}

export async function fetchIssueAttachments(
  apiKey: string,
  issueId: string,
  options?: { titleFilter?: string },
): Promise<LinearAttachment[]> {
  const titleFilter = options?.titleFilter;
  const query =
    titleFilter !== undefined
      ? `query IssueAttachments($id: String!, $titleFilter: String!) {
    issue(id: $id) {
      attachments(filter: { title: { eq: $titleFilter } }, first: 25) {
        nodes { id url sourceType title }
      }
    }
  }`
      : `query IssueAttachments($id: String!) {
    issue(id: $id) {
      attachments(first: 25) {
        nodes { id url sourceType title }
      }
    }
  }`;
  const variables: Record<string, unknown> =
    titleFilter !== undefined ? { id: issueId, titleFilter } : { id: issueId };
  const data = await linearRequest<{
    issue: { attachments?: { nodes?: LinearAttachment[] } } | null;
  }>(apiKey, query, variables);
  return data.issue?.attachments?.nodes ?? [];
}

export async function fetchAttachmentsForIssues(
  apiKey: string,
  issueIds: string[],
): Promise<Map<string, LinearAttachment[]>> {
  const out = new Map<string, LinearAttachment[]>();
  if (issueIds.length === 0) return out;

  const query = `query IssuesAttachments($ids: [ID!]!) {
    issues(filter: { id: { in: $ids } }, first: 250) {
      nodes {
        id
        attachments(first: 25) {
          nodes { id url sourceType title }
        }
      }
    }
  }`;
  const data = await linearRequest<{
    issues: { nodes: { id: string; attachments?: { nodes?: LinearAttachment[] } }[] };
  }>(apiKey, query, { ids: issueIds });
  for (const node of data.issues.nodes) {
    out.set(node.id, node.attachments?.nodes ?? []);
  }
  return out;
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
        relations(first: 50) {
          nodes { type relatedIssue { id identifier state { type } } }
        }
      }
    }
  }`;
  const data = await linearRequest<{
    issues: {
      nodes: {
        id: string;
        relations?: {
          nodes?: {
            type: string;
            relatedIssue: { id: string; identifier: string; state: { type: string } };
          }[];
        };
      }[];
    };
  }>(apiKey, query, { ids: issueIds });

  const DONE_STATE_TYPES = new Set(["completed", "cancelled"]);
  for (const node of data.issues.nodes) {
    const blockers = (node.relations?.nodes ?? [])
      .filter((r) => r.type === "blocked_by" && !DONE_STATE_TYPES.has(r.relatedIssue.state.type))
      .map((r) => ({ id: r.relatedIssue.id, identifier: r.relatedIssue.identifier }));
    out.set(node.id, blockers);
  }
  return out;
}

export async function findIssueAttachmentByTitle(
  apiKey: string,
  issueId: string,
  title: string,
): Promise<string | null> {
  const query = `query IssueAttachmentByTitle($id: String!) {
    issue(id: $id) {
      attachments(first: 50) {
        nodes { id title }
      }
    }
  }`;
  const data = await linearRequest<{
    issue: { attachments?: { nodes?: { id: string; title: string | null }[] } } | null;
  }>(apiKey, query, { id: issueId });
  const nodes = data.issue?.attachments?.nodes ?? [];
  const match = nodes.find((n) => n.title === title);
  return match?.id ?? null;
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
  issue: Pick<LinearIssue, "labels" | "state" | "project"> & {
    comments?: { body: string; user?: { name: string } | null }[];
  },
  indicator: GetIndicator | undefined,
): boolean {
  if (!indicator || indicator.filter.length === 0) return false;
  const labels = new Set(issue.labels.map((l) => l.toLowerCase()));
  const stateName = issue.state.name.toLowerCase();
  const projectName = issue.project?.name.toLowerCase() ?? null;
  return indicator.filter.some((m) => {
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
