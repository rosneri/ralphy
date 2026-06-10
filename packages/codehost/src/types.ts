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
  /** Settled CI bucket for a PR (absorbs the gh retry / partial-access
   *  salvage logic that previously lived in the agent's `ci.ts`). */
  getChecksStatus(prRef: string): Promise<CiStatus>;
  /** Push the branch and open the PR; returns the existing PR's URL when one
   *  is already open for the branch (idempotent — safe to retry). */
  createPullRequest(options: CreatePullRequestOptions): Promise<string>;
  markReady(url: string): Promise<void>;
  enableAutoMerge(url: string, strategy: MergeStrategy): Promise<void>;
  /** Merge the PR directly (the manual-merge fallback when native auto-merge
   *  is unavailable). Throws on failure; callers own the log-and-continue
   *  policy. */
  merge(url: string, strategy: MergeStrategy): Promise<void>;
}
