/**
 * GitHub *issue* transport — a function bag mirroring `linear-client.ts` but
 * running over the `gh` CLI (`CmdRunner`) instead of GraphQL over `fetch`.
 *
 * Every operation runs through the shared `gh` capability shell
 * (`ghCapability` → `runCapability`) so it inherits bus telemetry, uniform
 * error formatting, and the rate-limit / no-retry-on-auth retry policy. There
 * is no new auth: all calls rely on ambient `gh auth`, the same model the
 * existing `gh` call sites use. No octokit dependency.
 *
 * Issue discovery is **list-then-filter** (`gh issue list`); the GitHub Search
 * API (subject to a 30 req/min cap) is never used on a per-poll basis.
 *
 * Output is provider-neutral: `TrackedIssue` / `TrackedComment` deliberately
 * converge with `LinearIssue` / `LinearComment` so downstream consumers can
 * treat both providers uniformly. `state.type` is derived from open/closed +
 * `stateReason` + status labels (see `deriveTrackedState`).
 */

import type { Bus } from "@ralphy/events";
import type { CmdRunner } from "../../../agent/pr";
import { branchForChange } from "../../../agent/worktree";
import { ghCapability } from "../gh-client";
import { runCapability } from "../run-capability";

// ---------------------------------------------------------------------------
// Provider-neutral output types
// ---------------------------------------------------------------------------

export interface TrackedIssueState {
  /** Raw provider state name, e.g. "OPEN" / "CLOSED" (or a status-label name). */
  name: string;
  /** Provider-neutral lifecycle bucket, aligned with Linear's `state.type`. */
  type: "unstarted" | "started" | "completed" | "canceled";
}

export interface TrackedComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; email: string | null } | null;
}

export interface TrackedIssue {
  /** Provider-qualified id; for GitHub the node id or `#123` fallback. */
  id: string;
  /** Display identifier, e.g. "#123". */
  identifier: string;
  number: number;
  title: string;
  /** gh `body`. */
  description: string | null;
  url: string;
  state: TrackedIssueState;
  assignee: { id: string; email: string | null; name: string } | null;
  labels: string[];
  createdAt: string;
  comments?: TrackedComment[];
}

/** List-then-filter spec for `listIssues`. */
export interface GitHubFilterSpec {
  state?: "open" | "closed" | "all";
  /** Repeated `--label` flags — ANDed by `gh`. */
  labels?: string[];
  assignee?: string;
  limit?: number;
  includeComments?: boolean;
}

/** Optional execution context shared by every function. */
export interface GitHubClientCtx {
  bus?: Bus;
}

// ---------------------------------------------------------------------------
// Identifier parsing / slugging
// ---------------------------------------------------------------------------

export interface ParsedGitHubIdentifier {
  /** null for a bare `#123` / `123`. */
  owner: string | null;
  repo: string | null;
  number: number;
}

const GH_IDENTIFIER_RE = /^(?:([\w.-]+)\/([\w.-]+))?#?(\d+)$/;
const GH_CHANGE_NAME_RE = /^gh-(\d+)(?:-.*)?$/;
const GH_BRANCH_RE = /^ralph\/gh-(\d+)(?:-.*)?$/;

/**
 * Parse a GitHub issue reference in the forms `#123`, `123`, or
 * `owner/repo#123`. Throws on malformed input.
 */
export function parseGitHubIdentifier(ref: string): ParsedGitHubIdentifier {
  const m = GH_IDENTIFIER_RE.exec(ref.trim());
  if (!m) {
    const err = new Error("invalid GitHub issue identifier") as Error & { value?: string };
    err.value = ref;
    throw err;
  }
  return { owner: m[1] ?? null, repo: m[2] ?? null, number: Number(m[3]) };
}

/** Minimal issue shape the slugger / strategy needs. */
export interface GitHubIssueRef {
  number: number;
  title: string;
  owner?: string | null;
  repo?: string | null;
}

/** Slug rules identical to `changeNameForIssue` (lowercase, non-alnum→`-`,
 *  slice 40, trim dashes). */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** `gh-<number>-<title-slug>` (fallback `gh-<number>` when slug empty). */
export function changeNameForGitHubIssue(issue: GitHubIssueRef): string {
  const slug = slugifyTitle(issue.title);
  return slug ? `gh-${issue.number}-${slug}` : `gh-${issue.number}`;
}

/** `ralph/gh-<number>-<slug>` — delegates to `branchForChange` so it is
 *  byte-identical to the branch the worktree is actually created on. */
export function branchNameForGitHubIssue(issue: GitHubIssueRef): string {
  return branchForChange(changeNameForGitHubIssue(issue));
}

/** Recover the issue number from a `gh-<number>-…` change-name, else null. */
export function numberFromGitHubChangeName(name: string): number | null {
  const m = GH_CHANGE_NAME_RE.exec(name);
  return m ? Number(m[1]) : null;
}

/** Recover the issue number from a `ralph/gh-<number>-…` branch, else null. */
export function numberFromGitHubBranch(branch: string): number | null {
  const m = GH_BRANCH_RE.exec(branch);
  return m ? Number(m[1]) : null;
}

/** GitHub identifier strategy implementation — wraps the slugger functions
 *  above. Conformance to `IdentifierStrategy` is enforced (and the public
 *  `githubIdentifierStrategy` name assigned) where it is re-exported
 *  (`identifier-strategy.ts`); leaving it inferred here avoids a runtime
 *  import cycle. */
export const githubIdentifierStrategyImpl = {
  scopeKey: (issue: GitHubIssueRef): string =>
    issue.owner && issue.repo ? `${issue.owner}/${issue.repo}` : "",
  changeName: (issue: GitHubIssueRef): string => changeNameForGitHubIssue(issue),
  branchName: (issue: GitHubIssueRef): string => branchForChange(changeNameForGitHubIssue(issue)),
};

// ---------------------------------------------------------------------------
// gh-JSON → Tracked mapping
// ---------------------------------------------------------------------------

interface GhLabelJson {
  name: string;
}

interface GhUserJson {
  login?: string;
}

interface GhAssigneeJson {
  id?: string;
  login?: string;
  name?: string;
}

interface GhCommentJson {
  id?: string;
  body?: string | null;
  createdAt?: string;
  author?: GhUserJson | null;
}

interface GhIssueJson {
  id?: string;
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  stateReason?: string | null;
  labels?: GhLabelJson[] | null;
  assignees?: GhAssigneeJson[] | null;
  author?: GhUserJson | null;
  createdAt?: string;
  url?: string;
  comments?: GhCommentJson[] | null;
}

const STATUS_LABEL_PREFIX = "status:";
const STARTED_LABEL_NAMES = new Set(["in progress", "in-progress", "started"]);

/** Return the in-progress status label (if any) that refines an OPEN issue
 *  to `started`. Pure helper, unit-tested in isolation. */
export function statusLabelType(labels: string[]): { name: string; type: "started" } | null {
  for (const label of labels) {
    const normalized = label.toLowerCase().replace(STATUS_LABEL_PREFIX, "").trim();
    if (STARTED_LABEL_NAMES.has(normalized)) return { name: label, type: "started" };
  }
  return null;
}

/** Map `state` (OPEN/CLOSED) + `stateReason` + status labels to a
 *  provider-neutral `TrackedIssueState`. */
export function deriveTrackedState(
  state: string,
  stateReason: string | null,
  labels: string[],
): TrackedIssueState {
  if (state.toUpperCase() === "CLOSED") {
    const type = stateReason?.toUpperCase() === "NOT_PLANNED" ? "canceled" : "completed";
    return { name: state, type };
  }
  const started = statusLabelType(labels);
  if (started) return { name: started.name, type: "started" };
  return { name: state, type: "unstarted" };
}

export function mapGhComment(json: GhCommentJson): TrackedComment {
  const login = json.author?.login;
  return {
    id: json.id ?? "",
    body: json.body ?? "",
    createdAt: json.createdAt ?? "",
    user: login ? { name: login, email: null } : null,
  };
}

export function mapGhIssue(json: GhIssueJson): TrackedIssue {
  const labels = (json.labels ?? []).map((l) => l.name);
  const first = (json.assignees ?? [])[0];
  const assignee = first
    ? { id: first.id ?? first.login ?? "", email: null, name: first.name || first.login || "" }
    : null;
  const issue: TrackedIssue = {
    id: json.id ?? `#${json.number}`,
    identifier: `#${json.number}`,
    number: json.number,
    title: json.title ?? "",
    description: json.body ?? null,
    url: json.url ?? "",
    state: deriveTrackedState(json.state ?? "OPEN", json.stateReason ?? null, labels),
    assignee,
    labels,
    createdAt: json.createdAt ?? "",
  };
  if (json.comments) issue.comments = json.comments.map(mapGhComment);
  return issue;
}

// ---------------------------------------------------------------------------
// Function bag over the `gh` capability
// ---------------------------------------------------------------------------

const ISSUE_FIELDS = "id,number,title,body,state,stateReason,labels,assignees,author,createdAt,url";
const ISSUE_FIELDS_WITH_COMMENTS = `${ISSUE_FIELDS},comments`;
const DEFAULT_LIMIT = 100;

/** Run a `gh` subcommand through the capability shell with an op-specific bus
 *  prefix (`gh.issue.<op>`). `args` MUST omit the leading `gh` token — the
 *  capability prepends it. */
function ghRun(
  runner: CmdRunner,
  cwd: string,
  op: string,
  args: string[],
  ctx: GitHubClientCtx,
): Promise<{ stdout: string; stderr: string }> {
  const runCtx = ctx.bus ? { bus: ctx.bus } : {};
  return runCapability(ghCapability(`gh.issue.${op}`), { runner, cwd, args }, runCtx);
}

function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("gh returned empty output where JSON was expected");
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error("gh returned non-JSON output");
  }
}

/** Split a ref into a `--repo owner/repo` flag (when present) and the issue
 *  argument. A bare `#123` / `123` is passed through verbatim so `gh` resolves
 *  it against the cwd repo. */
function resolveRef(ref: string): { repoFlag: string[]; issueArg: string } {
  const { owner, repo, number } = parseGitHubIdentifier(ref);
  if (owner && repo) return { repoFlag: ["--repo", `${owner}/${repo}`], issueArg: String(number) };
  return { repoFlag: [], issueArg: ref };
}

export async function listIssues(
  runner: CmdRunner,
  cwd: string,
  spec: GitHubFilterSpec = {},
  ctx: GitHubClientCtx = {},
): Promise<TrackedIssue[]> {
  const args = ["issue", "list", "--state", spec.state ?? "open"];
  for (const label of spec.labels ?? []) args.push("--label", label);
  if (spec.assignee) args.push("--assignee", spec.assignee);
  args.push("--limit", String(spec.limit ?? DEFAULT_LIMIT));
  args.push("--json", spec.includeComments ? ISSUE_FIELDS_WITH_COMMENTS : ISSUE_FIELDS);
  const { stdout } = await ghRun(runner, cwd, "list", args, ctx);
  return parseJsonOutput<GhIssueJson[]>(stdout).map(mapGhIssue);
}

export async function viewIssue(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  ctx: GitHubClientCtx = {},
): Promise<TrackedIssue> {
  const { repoFlag, issueArg } = resolveRef(ref);
  const args = ["issue", "view", issueArg, ...repoFlag, "--json", ISSUE_FIELDS_WITH_COMMENTS];
  const { stdout } = await ghRun(runner, cwd, "view", args, ctx);
  return mapGhIssue(parseJsonOutput<GhIssueJson>(stdout));
}

export async function listComments(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  ctx: GitHubClientCtx = {},
): Promise<TrackedComment[]> {
  const { repoFlag, issueArg } = resolveRef(ref);
  const args = ["issue", "view", issueArg, ...repoFlag, "--json", "comments"];
  const { stdout } = await ghRun(runner, cwd, "comments", args, ctx);
  const json = parseJsonOutput<{ comments?: GhCommentJson[] | null }>(stdout);
  return (json.comments ?? []).map(mapGhComment);
}

export async function createComment(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  body: string,
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const { repoFlag, issueArg } = resolveRef(ref);
  await ghRun(
    runner,
    cwd,
    "comment",
    ["issue", "comment", issueArg, ...repoFlag, "--body", body],
    ctx,
  );
}

export async function addLabel(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  name: string,
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const { repoFlag, issueArg } = resolveRef(ref);
  await ghRun(
    runner,
    cwd,
    "add-label",
    ["issue", "edit", issueArg, ...repoFlag, "--add-label", name],
    ctx,
  );
}

export async function removeLabel(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  name: string,
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const { repoFlag, issueArg } = resolveRef(ref);
  await ghRun(
    runner,
    cwd,
    "remove-label",
    ["issue", "edit", issueArg, ...repoFlag, "--remove-label", name],
    ctx,
  );
}

export interface CreateLabelOpts {
  color?: string;
  description?: string;
  force?: boolean;
}

export async function createLabel(
  runner: CmdRunner,
  cwd: string,
  name: string,
  opts: CreateLabelOpts = {},
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const args = ["label", "create", name];
  if (opts.color) args.push("--color", opts.color);
  if (opts.description) args.push("--description", opts.description);
  if (opts.force) args.push("--force");
  await ghRun(runner, cwd, "create-label", args, ctx);
}

export interface TrackedLabel {
  name: string;
  id: string;
  description: string;
}

export async function listLabels(
  runner: CmdRunner,
  cwd: string,
  ctx: GitHubClientCtx = {},
): Promise<TrackedLabel[]> {
  const args = ["label", "list", "--json", "name,id,description", "--limit", String(DEFAULT_LIMIT)];
  const { stdout } = await ghRun(runner, cwd, "list-labels", args, ctx);
  return parseJsonOutput<Array<Partial<TrackedLabel>>>(stdout).map((l) => ({
    name: l.name ?? "",
    id: l.id ?? "",
    description: l.description ?? "",
  }));
}

export interface CloseIssueOpts {
  reason?: "completed" | "not planned";
}

export async function closeIssue(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  opts: CloseIssueOpts = {},
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const { repoFlag, issueArg } = resolveRef(ref);
  const args = ["issue", "close", issueArg, ...repoFlag];
  if (opts.reason) args.push("--reason", opts.reason);
  await ghRun(runner, cwd, "close", args, ctx);
}

export async function reopenIssue(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const { repoFlag, issueArg } = resolveRef(ref);
  await ghRun(runner, cwd, "reopen", ["issue", "reopen", issueArg, ...repoFlag], ctx);
}

/** Post a reaction via `gh api …/reactions`. Resolves `owner/repo` from the
 *  ref when present, else from `gh repo view --json nameWithOwner`. */
export async function addReaction(
  runner: CmdRunner,
  cwd: string,
  ref: string,
  content: string,
  ctx: GitHubClientCtx = {},
): Promise<void> {
  const parsed = parseGitHubIdentifier(ref);
  let owner = parsed.owner;
  let repo = parsed.repo;
  if (!owner || !repo) {
    const { stdout } = await ghRun(
      runner,
      cwd,
      "repo-view",
      ["repo", "view", "--json", "nameWithOwner"],
      ctx,
    );
    const nwo = parseJsonOutput<{ nameWithOwner?: string }>(stdout).nameWithOwner ?? "";
    const [resolvedOwner, resolvedRepo] = nwo.split("/");
    owner = resolvedOwner ?? null;
    repo = resolvedRepo ?? null;
  }
  const path = `repos/${owner}/${repo}/issues/${parsed.number}/reactions`;
  await ghRun(
    runner,
    cwd,
    "reaction",
    ["api", "-X", "POST", path, "-f", `content=${content}`],
    ctx,
  );
}
