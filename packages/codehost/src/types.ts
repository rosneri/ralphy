/**
 * `@ralphy/codehost` — the git/gh centralization port (issue #403).
 *
 * The code host owns "PR lifecycle on the hosting system" (GitHub today); the
 * tracker port (`@ralphy/tracker`) owns "issue lifecycle on the tracking
 * system". The two stay separate even when both are GitHub: PRs live on GitHub
 * regardless of which issue tracker is configured, so folding PR operations
 * into the tracker port would force the Linear adapter to duplicate `gh`
 * logic.
 */

/** Minimal command runner every adapter is driven through, so transports are
 *  fully scriptable in tests. Structurally identical to the agent's historical
 *  `CmdRunner` (which now re-exports this type). */
export interface CmdRunner {
  /** Run a command in the given cwd. Throws on non-zero exit; throw object exposes `stderr`. */
  run: (cmd: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

/** Lifecycle state of a pull request on the host. */
export type PullRequestState = "open" | "merged" | "closed";

/**
 * Richer PR probe — the normalized state plus the head branch, title, and
 * canonical URL. Used by callers that need more than the lifecycle state (e.g.
 * stacking a new PR onto a blocker's head branch), so they probe once through
 * the port rather than re-shelling a wider `gh pr view --json`.
 */
export interface PullRequestDetails {
  state: PullRequestState;
  /** The PR's head branch (the branch the PR merges *from*). */
  headRefName: string;
  /** The PR title. */
  title: string;
  /** Canonical PR URL as reported by the host. */
  url: string;
}

/** Merge strategy passed to the host's merge / auto-merge commands. */
export type MergeStrategy = "squash" | "merge" | "rebase";

/** Settled view of a PR's CI checks (the agent's 3-bucket model). */
export interface CiStatus {
  bucket: "pass" | "fail" | "pending";
  /** Workflow run IDs of failing checks (only populated when bucket is "fail"). */
  failedRunIds: string[];
  /** Names of failing checks (only populated when bucket is "fail"). */
  failedCheckNames: string[];
}

/**
 * Mechanism-level PR creation input. Policy (issue-derived titles, meta-only
 * diff guards, retry loops) stays with the caller — the port only pushes the
 * branch and opens (or surfaces) the PR.
 */
export interface CreatePullRequestOptions {
  /** Worktree to push from; defaults to the adapter's construction cwd. */
  cwd?: string;
  branch: string;
  /** Base branch the PR targets. */
  base: string;
  title: string;
  body: string;
  /** When true, open the PR as a draft. */
  draft?: boolean;
  /** Labels applied best-effort after the PR exists — a missing label never
   *  fails creation. */
  labels?: string[];
}

/**
 * The code-host port. One adapter (`createGhCliCodeHost`) funnels every
 * `gh`-CLI PR mechanism — state probes, checks classification with one retry
 * policy, idempotent creation, ready/auto-merge/merge transitions — that was
 * previously duplicated across the agent's call sites.
 */
export interface CodeHost {
  getPullRequestState(url: string): Promise<PullRequestState>;
  /** Richer single-probe view of a PR — state + head branch + title + URL.
   *  For callers that need more than the lifecycle state (e.g. dependency-base
   *  resolution stacks onto the blocker PR's `headRefName`). */
  getPullRequestDetails(url: string): Promise<PullRequestDetails>;
  /** Settled CI bucket for a PR (absorbs the gh retry / partial-access
   *  salvage logic that previously lived in the agent's `ci.ts`). */
  getChecksStatus(prRef: string): Promise<CiStatus>;
  /** Push the branch and open the PR; returns the existing PR's URL when one
   *  is already open for the branch (idempotent — safe to retry). */
  createPullRequest(options: CreatePullRequestOptions): Promise<string>;
  /** Best-effort idempotency query: the URL of the open PR whose head is
   *  `branch`, or null when none is open. The same query
   *  {@link createPullRequest} uses to surface an existing PR, exposed for
   *  callers that only need to *find* a PR (e.g. choosing a log level, or
   *  locating the PR to verify in conflict-fix mode). Swallows transient `gh`
   *  failures to null so callers can fall back rather than escalate. */
  findOpenPullRequestForBranch(branch: string): Promise<string | null>;
  /** Whether the PR's repo allows GitHub native auto-merge
   *  (`allow_auto_merge`):
   *   - `true`  → repo allows it (use `--auto`)
   *   - `false` → repo explicitly disables it (caller may fall back)
   *   - `null`  → undeterminable (malformed URL, `gh` failure, unparseable
   *               response); callers treat this as "assume enabled".
   *  Cached per repo for the adapter's lifetime so a multi-PR run pays the
   *  `gh` API hop at most once per repo. */
  isAutoMergeAllowed(prUrl: string): Promise<boolean | null>;
  markReady(url: string): Promise<void>;
  enableAutoMerge(url: string, strategy: MergeStrategy): Promise<void>;
  /** Merge the PR directly (the manual-merge fallback when native auto-merge
   *  is unavailable). Throws on failure; callers own the log-and-continue
   *  policy. */
  merge(url: string, strategy: MergeStrategy): Promise<void>;

  // --- Local git operations -------------------------------------------------
  // The PR / post-task flow runs these against a *per-task worktree*, never the
  // adapter's construction cwd, so each takes an explicit `cwd`. They are part
  // of the port (rather than a raw `git` shell-out at the call site) so the
  // agent has a single seam for every git/gh mechanism. Failures propagate
  // unchanged (the thrown error's `stderr`/`stdout` carry the blob callers
  // inspect) except where noted.

  /** `git rev-parse HEAD` — the worktree's current HEAD SHA (trimmed). */
  headSha(cwd: string): Promise<string>;
  /** `git merge-base --is-ancestor <ancestor> <descendant>` — true when
   *  `ancestor` is reachable from `descendant`. A non-zero git exit (not an
   *  ancestor, or either ref missing) resolves to `false` rather than throwing,
   *  so callers branch on the boolean instead of try/catch. */
  isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean>;
  /** `git fetch origin <branch>`. */
  fetchBranch(branch: string, cwd: string): Promise<void>;
  /** `git pull --no-rebase --autostash --no-edit origin <branch>` — merge
   *  (never rebase) the remote branch into the worktree. The thrown error's
   *  `stderr`/`stdout` carry the merge/conflict output callers classify. */
  pullBranch(branch: string, cwd: string): Promise<void>;
  /** `git merge --abort`. */
  abortMerge(cwd: string): Promise<void>;
  /** `git diff --name-only <range>` — the changed paths for a diff range
   *  (e.g. `origin/main...HEAD` or `HEAD..origin/feat`), trimmed and
   *  blank-filtered. */
  changedFiles(range: string, cwd: string): Promise<string[]>;
  /** `git status --porcelain` — raw porcelain output for the worktree. */
  workingTreeStatus(cwd: string): Promise<string>;
  /** `git rev-list --count <range>` — commit count for a range
   *  (e.g. `origin/<branch>..HEAD`), parsed to a number (0 when unparseable). */
  countCommitsAhead(range: string, cwd: string): Promise<number>;
}
