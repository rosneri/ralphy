import type { TrackedIssue } from "@ralphy/tracker";
import type { CmdRunner } from "../pr";
import type { DependencyBase } from "../wire/pr-helpers";
import type { CodeHost } from "@ralphy/codehost";

/** Worker exited 0 but the residual-commit / push / PR-create path failed. */
// allow-duplicate
export const PR_FAILED_EXIT = 71;
/**
 * Internal retry budget for the PR-create path's push-rejection / merge-conflict
 * fix loop and the only-meta reapply loop. These are mechanical retry guards,
 * not user-facing recovery policy — PR recovery proper is the watcher's job
 * (`prRecovery.*`), so this is a fixed constant rather than a config knob.
 */
export const MAX_PR_CREATE_ATTEMPTS = 5;
/**
 * Worker exited 0 and finished its tasks, but the branch never touched a
 * non-meta file across its whole history — the requested work is already on
 * the base branch (or was a no-op). Distinct from success-with-PR (0) and
 * failure (70/71): no PR is opened and the ticket is finalized as done with
 * an honest "no changes needed" comment rather than quarantined. See
 * `runPrPhase`'s `blocked: "no-op"` handling and the coordinator's
 * `notifyExited`.
 */
// allow-duplicate
export const NO_CHANGES_EXIT = 72;

/**
 * Spawn trigger the worker ran under. Threaded through from the coordinator
 * so post-task can short-circuit conflict-fix iterations (RLF-82) onto a
 * verify-only path. Optional for backwards-compat with callers that don't
 * yet thread it; absent ≡ legacy (non-conflict-fix) behavior.
 */
export type PostTaskMode = "fresh" | "resume" | "conflict-fix" | "review";

export interface PostTaskInput {
  /** Spawn trigger; see `PostTaskMode`. */
  mode?: PostTaskMode;
  /** Optional pre-resolved PR URL (from the wire layer's per-change cache).
   *  Used by the conflict-fix verify path so we can verify mergeability
   *  even when no branch is tracked (e.g. `useWorktree: false`). */
  prUrl?: string | null;
  changeName: string;
  /** Worker's working dir — worktree path if useWorktree, else projectRoot. */
  cwd: string;
  projectRoot: string;
  /** Absolute path to `openspec/changes/<changeName>/`. Computed by caller. */
  changeDir: string;
  /** Absolute path to `<statesDir>/<changeName>/.ralph-state.json`. */
  stateFilePath: string;
  branch: string | null;
  issue: TrackedIssue | null;
  /** Exit code from the worker subprocess. */
  exitCode: number;
  useWorktree: boolean;
  wantPr: boolean;
  wantAutoMerge: boolean;
  wantValidateOnly?: boolean;
  cfg: {
    teardownScript: string | null;
    prBaseBranch: string;
    /** Labels attached to every PR Ralph opens (best-effort). */
    prLabels?: string[];
    autoMergeStrategy: "squash" | "merge" | "rebase";
    cleanupWorktreeOnSuccess: boolean;
    stackPrsOnDependencies: boolean;
    /** Globs the agent is forbidden from modifying. Pre-PR check fails the
     *  iteration with a clear error when any committed file matches. */
    neverTouch: string[];
    /** Globs that mark a file as meta-only. When the base..HEAD diff
     *  contains only meta files, the PR is blocked and a fix task is
     *  prepended so the worker restores the substantive change. */
    metaOnlyFiles?: string[];
    /** When true (default), a branch whose entire history touched only meta
     *  files is finalized as done with a "no changes needed" comment instead
     *  of being quarantined as a lost implementation. Set false to restore the
     *  legacy reapply-then-quarantine behavior. */
    finalizeNoOpAsDone?: boolean;
    /** When the repo has `allow_auto_merge: false`, poll the PR after CI
     *  passes and merge it via plain `gh pr merge` instead of silently
     *  giving up on the requested auto-merge. Defaults to true. */
    manualMergeWhenAutoMergeDisabled?: boolean;
    /** When true, create the PR as a draft and call `gh pr ready` after CI
     *  passes before enabling auto-merge. */
    prDraft?: boolean;
    /** Shell commands to run when `wantValidateOnly` is true. Each command
     *  is run in order; the first failure triggers a fix task. */
    validateCommands?: string[];
  };
  /**
   * Re-spawn the worker with the same args used originally. Used by the
   * hook-fix and CI-fix retry paths after a fresh `## ` section has been
   * prepended to `tasks.md`. Returns the worker's exit code.
   */
  respawnWorker: () => Promise<number>;
}

/**
 * Phases the post-task block transitions through. The dashboard surfaces
 * the current phase + an optional human-readable detail next to each
 * active worker so a stuck operation (commit hook, push retry, gh poll)
 * is visible immediately.
 */
export type PostTaskPhase =
  | "pushing"
  | "push-retry"
  | "merging"
  | "pr-create"
  | "pr-only-meta"
  | "pr-skipped-noop"
  | "stacked-pr"
  | "auto-merge-enabled"
  | "conflict-check"
  | "conflict-fix-inner"
  | "ci-poll"
  | "ci-fix"
  | "pr-ready"
  | "validate"
  | "validate-fix"
  | "cleanup"
  | "done"
  | "gave-up"
  | "teardown";

/**
 * Info handed to the optional `runRetrospective` hook when a ticket reaches a
 * terminal disposition on the main post-task path. The dep (when wired) reads
 * these to drive a one-shot self-review pass. See `@ralphy/retro`.
 */
export interface RetroDispositionInfo {
  changeName: string;
  cwd: string;
  changeDir: string;
  stateFilePath: string;
  branch: string | null;
  issue: TrackedIssue | null;
  /** The effective exit code after all post-task phases. */
  effectiveCode: number;
}

// ---------------------------------------------------------------------------
// Shared context bundled once and threaded into helpers below.
// ---------------------------------------------------------------------------

export interface PostTaskCtx {
  changeName: string;
  cwd: string;
  branch: string;
  /** Effective PR base for this issue. Either cfg.prBaseBranch or a
   *  per-issue override from a `ralph:branch:<name>` Linear label. */
  base: string;
  /** Set when `base` came from a blocker PR (stacked PR) — surfaced in the
   *  PR body so the dependency is clear. */
  stackedOn?: DependencyBase;
  changeDir: string;
  stateFilePath: string;
  cfg: PostTaskInput["cfg"];
  cmd: CmdRunner;
  codeHost: CodeHost;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
}

/**
 * Parse `git status --porcelain` output for the post-worker uncommitted-changes
 * warning. Returns `count` (total entries), `preview` (first up to 10 entries
 * verbatim, status code + path), and `truncated` (how many more were dropped).
 */
export function summarizeUncommittedStatus(stdout: string): {
  count: number;
  preview: string[];
  truncated: number;
} {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  const preview = lines.slice(0, 10);
  return { count: lines.length, preview, truncated: Math.max(0, lines.length - preview.length) };
}
