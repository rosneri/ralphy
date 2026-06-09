import { join, dirname } from "node:path";
import { GAVEUP_COUNT_FILE } from "@ralphy/core/layout";
import { AGENT_TASKS_FILENAME, prependFixTask } from "@ralphy/core/tasks-md";
import { fsChange } from "../shared/capabilities/fs-change";
import { git as gitCap } from "../shared/capabilities/git";
import { runCapability } from "../shared/capabilities/run-capability";
import { findBoundaryViolations } from "@ralphy/workflow/boundaries";
import { baseBranchFromLabels, type LinearIssue } from "./linear";
import type { GitRunner } from "./worktree";
import type { CmdRunner } from "./pr";
import { createPullRequest } from "./pr";
import type { DependencyBase } from "./wire/pr-helpers";
import { fetchPrStatus, type PrStatus } from "../pr-status";
import { waitForMergeability } from "../shared/pr/wait-for-mergeability";
import { isWorktreeSafeToRemove } from "./worktree";
import { registry as featureRegistry } from "../features/registry";
import { runFeaturePostTask } from "../features/run-feature";
import type { FeatureCtx } from "../features/types";

/** Worker exited 0 but the residual-commit / push / PR-create path failed. */
// allow-duplicate
const PR_FAILED_EXIT = 71;
/**
 * Internal retry budget for the PR-create path's push-rejection / merge-conflict
 * fix loop and the only-meta reapply loop. These are mechanical retry guards,
 * not user-facing recovery policy — PR recovery proper is the watcher's job
 * (`prRecovery.*`), so this is a fixed constant rather than a config knob.
 */
const MAX_PR_CREATE_ATTEMPTS = 5;
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
  issue: LinearIssue | null;
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
  issue: LinearIssue | null;
  /** The effective exit code after all post-task phases. */
  effectiveCode: number;
}

interface PostTaskDeps {
  cmd: CmdRunner;
  git: GitRunner;
  log: (text: string, color?: string) => void;
  /**
   * Optional opt-in (`--agent-debug`): run a one-shot retrospective self-review
   * after the ticket reaches its terminal disposition and before worktree
   * cleanup (so the worktree artifacts are still readable). The dep owns its
   * own error isolation and must never throw. Omitted on normal runs.
   */
  runRetrospective?: (info: RetroDispositionInfo) => Promise<void>;
  /** Run a shell command and surface non-zero exit via `log`, never throw. */
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  /** Optional: record the URL of the PR opened (or surfaced) for this
   *  changeName. Used by the agent coordinator's conflict-scan to know
   *  which changes to check for merge conflicts on subsequent polls. */
  registerPr?: (changeName: string, prUrl: string) => void;
  /** Optional: apply the additive `setPrReady` Linear marker at the PR-phase
   *  success point. Forwarded into `runPrPhase`. See PrPhaseDeps for the skip
   *  rule and failure-isolation contract. */
  onPrReady?: (prUrl: string) => Promise<void>;
  /** Optional phase emitter — surfaced in the dashboard footer. */
  onPhase?: (phase: PostTaskPhase, detail?: string) => void;
  /** Optional: resolve the blocker PR a stacked PR should base on. See
   *  PrPhaseDeps for details. */
  resolveDependencyBaseBranch?: (issue: LinearIssue) => Promise<DependencyBase | null>;
  /** Optional: build the per-issue `FeatureCtx` consumed by the feature
   *  registry walk. When provided, `runPostTask` iterates the registry and
   *  invokes `feature.postTask?.(...)` on each entry alongside the legacy
   *  phases. Stub features have no `postTask`, so this dispatch is a no-op
   *  until a slice migrates. Omitted in today's wire layer; the legacy
   *  phases still own the full post-task flow in that case. */
  buildFeatureCtx?: (issue: LinearIssue) => FeatureCtx | null;
  /**
   * Override the backoff schedule (ms) for the conflict-fix verify path's
   * UNKNOWN-mergeability polling. Default is the shared
   * `DEFAULT_BACKOFFS_MS` (~31s total). Tests pass `[0, 0, 0]` to keep
   * the historical 3-retry contract instant.
   */
  _mergeabilityBackoffsMs?: number[];
}

// ---------------------------------------------------------------------------
// Shared context bundled once and threaded into helpers below.
// ---------------------------------------------------------------------------

interface PostTaskCtx {
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
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether the GitHub repo that owns `prUrl` has auto-merge enabled
 * (`allow_auto_merge: true`). Returns:
 *   - `true`  → repo allows auto-merge (use `gh pr merge --auto`)
 *   - `false` → repo explicitly disables it (caller may fall back to polling)
 *   - `null`  → could not determine (malformed URL, gh failure, unparseable
 *               response). Caller treats this as "assume enabled" so we never
 *               regress repos where the API call fails for unrelated reasons.
 *
 * Results are cached per repo across calls so a multi-PR run only pays the
 * gh API hop once.
 */
const repoAutoMergeCache = new Map<string, boolean | null>();

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

/**
 * Best-effort check for an existing open PR for `branch`. Returns the URL or
 * null. Mirrors the query used by `createPullRequest` so the post-task log can
 * pick a quieter log level on long-running PR branches without coupling to the
 * PR-creation path. Failures swallow to null — the caller falls back to the
 * yellow warning rather than escalate transient gh errors.
 */
async function findExistingOpenPrUrl(
  cmd: CmdRunner,
  cwd: string,
  branch: string,
): Promise<string | null> {
  try {
    const result = await cmd.run(
      [
        "gh",
        "pr",
        "list",
        "--head",
        branch,
        "--state",
        "open",
        "--json",
        "url",
        "--jq",
        ".[0].url // empty",
      ],
      cwd,
    );
    const url = result.stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}
async function detectRepoAutoMergeAllowed(
  prUrl: string,
  cmd: CmdRunner,
  cwd: string,
  log: (text: string, color?: string) => void,
): Promise<boolean | null> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/.exec(prUrl);
  if (!m) return null;
  const repoKey = `${m[1]}/${m[2]}`;
  if (repoAutoMergeCache.has(repoKey)) return repoAutoMergeCache.get(repoKey) ?? null;
  try {
    const res = await cmd.run(["gh", "api", `repos/${repoKey}`, "--jq", ".allow_auto_merge"], cwd);
    const out = res.stdout.trim().toLowerCase();
    let result: boolean | null;
    if (out === "true") result = true;
    else if (out === "false") result = false;
    else result = null;
    repoAutoMergeCache.set(repoKey, result);
    return result;
  } catch (err) {
    log(
      `! could not detect repo auto-merge capability for ${repoKey}: ${(err as Error).message}`,
      "yellow",
    );
    repoAutoMergeCache.set(repoKey, null);
    return null;
  }
}

/** Test-only: clear the per-repo auto-merge capability cache. */
export function _resetRepoAutoMergeCache(): void {
  repoAutoMergeCache.clear();
}

/**
 * The loop sets state.status="completed" once tasks.md has no unchecked
 * items. A re-spawned worker would then exit immediately via
 * checkStopCondition without ever reading the freshly-prepended fix task.
 * Reset to "active" so the new section gets picked up.
 */
async function reactivateState(
  stateFilePath: string,
  log: PostTaskDeps["log"],
  changeName: string,
): Promise<void> {
  const file = Bun.file(stateFilePath);
  if (!(await file.exists())) return;
  try {
    const stateObj = JSON.parse(await file.text()) as {
      status?: string;
      lastModified?: string;
    };
    if (stateObj.status !== "active") {
      stateObj.status = "active";
      stateObj.lastModified = new Date().toISOString();
      await Bun.write(stateFilePath, JSON.stringify(stateObj, null, 2) + "\n");
    }
  } catch (err) {
    log(`! could not reactivate state for ${changeName}: ${(err as Error).message}`, "yellow");
  }
}

/**
 * Prepend a fix task to tasks.md, reactivate the loop state so the worker
 * picks it up, and re-spawn the worker. Returns the worker's exit code.
 */
async function runWorkerWithFixTask(
  ctx: PostTaskCtx,
  heading: string,
  body: string,
): Promise<number> {
  try {
    await runCapability(fsChange.prependTask, {
      tasksPath: join(ctx.changeDir, AGENT_TASKS_FILENAME),
      heading,
      failureOutput: body,
    });
  } catch (err) {
    ctx.log(`! could not prepend fix task: ${(err as Error).message}`, "red");
    return 1;
  }
  await reactivateState(ctx.stateFilePath, ctx.log, ctx.changeName);

  // Append-only history guard: snapshot HEAD before respawn and require the
  // post-respawn HEAD to be a descendant. This prevents a fix worker from
  // "fixing" a failure by reverting/rebasing/amending its own commits — the
  // failure mode that produced PRs whose diff silently lost work.
  let preHead = "";
  try {
    const r = await ctx.cmd.run(["git", "rev-parse", "HEAD"], ctx.cwd);
    preHead = r.stdout.trim();
  } catch (err) {
    ctx.log(`! could not snapshot HEAD before fix task: ${(err as Error).message}`, "yellow");
  }

  const code = await ctx.respawnWorker();

  if (preHead) {
    try {
      const r = await ctx.cmd.run(["git", "rev-parse", "HEAD"], ctx.cwd);
      const postHead = r.stdout.trim();
      if (postHead !== preHead) {
        let isAncestor = true;
        try {
          await ctx.cmd.run(["git", "merge-base", "--is-ancestor", preHead, postHead], ctx.cwd);
        } catch {
          isAncestor = false;
        }
        if (!isAncestor) {
          ctx.log(
            `! fix worker for "${heading}" rewrote history — pre=${preHead.slice(0, 8)} ` +
              `is not an ancestor of post=${postHead.slice(0, 8)}. Aborting and preserving ` +
              `worktree at ${ctx.cwd}.`,
            "red",
          );
          return 1;
        }
      }
    } catch (err) {
      ctx.log(
        `! could not verify append-only history after fix task: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  return code;
}

/**
 * Push the branch and open (or surface) a GitHub PR, retrying on push
 * rejections (pre-push hooks, non-fast-forward) by feeding failure output
 * back to the worker as a fix task. Shares the `hookFixAttempt` budget with
 * the commit phase.
 *
 * Returns `{ pr, gaveUp }`. When `gaveUp` is true the caller should set
 * effectiveCode = PR_FAILED_EXIT; `pr` will be null in that case.
 */
async function createPrWithRetry(
  ctx: PostTaskCtx,
  issue: LinearIssue,
): Promise<{ pr: Awaited<ReturnType<typeof createPullRequest>>; gaveUp: boolean }> {
  const base = ctx.base;
  const maxAttempts = MAX_PR_CREATE_ATTEMPTS;
  let hookFixAttempt = 0;
  let nonFfRebaseAttempted = false;
  let pr: Awaited<ReturnType<typeof createPullRequest>> = null;

  while (true) {
    try {
      ctx.emit("pr-create", "git push + gh pr create");
      pr = await createPullRequest(
        {
          cwd: ctx.cwd,
          branch: ctx.branch,
          issue,
          base,
          metaOnlyFiles: ctx.cfg.metaOnlyFiles ?? [],
          draft: ctx.cfg.prDraft ?? false,
          labels: ctx.cfg.prLabels ?? [],
          ...(ctx.stackedOn
            ? {
                stackedOn: {
                  prUrl: ctx.stackedOn.prUrl,
                  prNumber: ctx.stackedOn.prNumber,
                  blockerIdentifier: ctx.stackedOn.blockerIdentifier,
                },
              }
            : {}),
        },
        ctx.cmd,
      );
      return { pr, gaveUp: false };
    } catch (err) {
      const e = err as Error & { stderr?: string; stdout?: string; code?: number };
      const detail = e.stderr?.trim() || e.message;
      const combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;

      const isNonFastForward =
        /non-fast-forward|Updates were rejected because the (tip of your current branch is behind|remote contains work)/i.test(
          combined,
        ) && !/pre-push hook|hook declined/i.test(combined);
      const isHookReject = /pre-push hook|hook declined/i.test(combined);
      const pushRejected = isHookReject || /failed to push some refs/i.test(combined);

      if (isNonFastForward && !nonFfRebaseAttempted) {
        nonFfRebaseAttempted = true;
        ctx.emit("merging", `git pull --no-rebase origin ${ctx.branch}`);
        ctx.log(
          `  non-fast-forward push for ${ctx.changeName} — merging origin/${ctx.branch} into the branch`,
          "yellow",
        );
        try {
          await ctx.cmd.run(["git", "fetch", "origin", ctx.branch], ctx.cwd);
          await ctx.cmd.run(
            ["git", "pull", "--no-rebase", "--autostash", "--no-edit", "origin", ctx.branch],
            ctx.cwd,
          );
          continue;
        } catch (mergeErr) {
          const re = mergeErr as Error & { stderr?: string; stdout?: string };
          const reBlob = `${re.stdout ?? ""}\n${re.stderr ?? ""}`;
          const isConflict = /CONFLICT|Merge conflict|both modified/i.test(reBlob);
          if (!isConflict) {
            ctx.log(
              `! merge failed for ${ctx.changeName}: ${(mergeErr as Error).message} — giving up`,
              "red",
            );
            return { pr: null, gaveUp: true };
          }

          ctx.emit("merging", "conflicts detected — aborting + queueing fix task");
          try {
            await ctx.cmd.run(["git", "merge", "--abort"], ctx.cwd);
          } catch (err) {
            ctx.log(
              `! git merge --abort failed (worktree may already be clean): ${(err as Error).message}`,
              "yellow",
            );
          }

          let conflictedFiles = "";
          try {
            const r = await ctx.cmd.run(
              ["git", "diff", "--name-only", `HEAD..origin/${ctx.branch}`],
              ctx.cwd,
            );
            conflictedFiles = r.stdout.trim();
          } catch (err) {
            ctx.log(`! could not list conflicted files: ${(err as Error).message}`, "yellow");
          }

          if (hookFixAttempt >= maxAttempts) {
            ctx.log(
              `! merge conflict merging origin/${ctx.branch} after ${hookFixAttempt} attempts — worktree preserved at ${ctx.cwd}`,
              "red",
            );
            ctx.log(`    detail: ${reBlob.trim().split("\n").slice(0, 8).join("\n")}`, "red");
            return { pr: null, gaveUp: true };
          }

          hookFixAttempt += 1;
          ctx.emit("merging", `conflict-fix ${hookFixAttempt}/${maxAttempts}`);
          ctx.log(
            `! merge conflict merging origin/${ctx.branch} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxAttempts})`,
            "yellow",
          );

          const retryCode = await runWorkerWithFixTask(
            ctx,
            "Resolve merge conflict with origin/" + ctx.branch,
            `Push to origin/${ctx.branch} was rejected as non-fast-forward, and merging ` +
              `origin/${ctx.branch} into the branch produced merge conflicts.\n\n` +
              `Run \`git fetch origin ${ctx.branch}\` and \`git merge origin/${ctx.branch}\`, ` +
              `resolve every conflict, \`git add\` the resolved files, and finish with ` +
              `\`git commit\` (or \`git merge --continue\`). Do NOT rebase and do NOT ` +
              `amend existing commits — only add new commits. The push will be retried ` +
              `after this loop iteration finishes.\n\n` +
              (conflictedFiles
                ? `Files that differ between your branch and origin/${ctx.branch}:\n${conflictedFiles}\n\n`
                : "") +
              `Merge output:\n${reBlob.trim()}`,
          );
          if (retryCode !== 0) {
            ctx.log(
              `! worker re-run after merge conflict exited code ${retryCode} — giving up`,
              "red",
            );
            return { pr: null, gaveUp: true };
          }
          nonFfRebaseAttempted = false;
          continue;
        }
      }

      if (!pushRejected || hookFixAttempt >= maxAttempts) {
        if (pushRejected) {
          ctx.log(
            `! push rejected for ${ctx.changeName} after ${hookFixAttempt} fix attempts (push still failing) — worktree preserved at ${ctx.cwd}`,
            "red",
          );
          ctx.log(`    detail: ${detail}`, "red");
        } else {
          ctx.log(`! PR create failed for ${ctx.changeName}: ${detail}`, "red");
        }
        return { pr: null, gaveUp: true };
      }

      hookFixAttempt += 1;
      ctx.emit("push-retry", `${hookFixAttempt}/${maxAttempts}`);
      ctx.log(
        `! push rejected for ${ctx.changeName} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxAttempts})`,
        "yellow",
      );
      ctx.log(`    detail: ${detail}`, "yellow");

      const retryCode = await runWorkerWithFixTask(
        ctx,
        "Fix push rejection",
        `Push to origin/${ctx.branch} was rejected. Fix the underlying problem ` +
          `(e.g. failing pre-push hook checks), then the push will be retried.\n\n` +
          `Do NOT delete, revert, amend, rebase, reorder, or squash existing commits. ` +
          `Only add new commits or edit working-tree files. If a pre-push check (test, ` +
          `lint, typecheck, etc.) fails on the change you just made, fix the test or ` +
          `the code under test — do not remove the change to silence the failure.\n\n` +
          combined.trim(),
      );
      if (retryCode !== 0) {
        ctx.log(`! worker re-run after push rejection exited code ${retryCode} — giving up`, "red");
        return { pr: null, gaveUp: true };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Phase functions — each handles one step of the post-task flow and can be
// tested in isolation by passing minimal deps.
// ---------------------------------------------------------------------------

/** Inputs consumed only by the PR phase. */
interface PrPhaseInput {
  changeName: string;
  cwd: string;
  branch: string | null;
  changeDir: string;
  stateFilePath: string;
  issue: LinearIssue | null;
  wantAutoMerge: boolean;
  cfg: PostTaskInput["cfg"];
}

/**
 * Pre-PR boundary check. Compares the change set (relative to the base
 * branch) against `boundaries.never_touch`. Returns the list of forbidden
 * files that the agent modified anyway, or an empty array when clean.
 */
async function findNeverTouchViolations(
  cmd: CmdRunner,
  cwd: string,
  base: string,
  neverTouch: string[],
): Promise<{ file: string; pattern: string }[]> {
  if (neverTouch.length === 0) return [];
  let raw = "";
  try {
    const r = await cmd.run(["git", "diff", "--name-only", `origin/${base}...HEAD`], cwd);
    raw = r.stdout;
  } catch {
    // Fall back to local base ref when origin/<base> isn't fetched.
    try {
      const r = await cmd.run(["git", "diff", "--name-only", `${base}...HEAD`], cwd);
      raw = r.stdout;
    } catch {
      return [];
    }
  }
  const files = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return findBoundaryViolations(files, neverTouch);
}

/** Deps consumed only by the PR phase. */
interface PrPhaseDeps {
  cmd: CmdRunner;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
  registerPr?: (changeName: string, prUrl: string) => void;
  /** Optional: apply the additive `setPrReady` Linear marker. Invoked once at
   *  the PR-phase success point, EXCEPT on the immediate non-draft auto-merge
   *  path (`wantAutoMerge && !prReadyNeeded`). Mirrors `registerPr`; failures
   *  are the callback's responsibility to swallow (they must not abort the
   *  run). */
  onPrReady?: (prUrl: string) => Promise<void>;
  /** Optional: resolve the blocker PR (branch + ticket + PR) the given issue
   *  should stack onto, or null when no unambiguous blocker PR exists. Invoked
   *  only when `cfg.stackPrsOnDependencies` is true and no `ralph:branch:`
   *  label override is present. */
  resolveDependencyBaseBranch?: (issue: LinearIssue) => Promise<DependencyBase | null>;
}

/**
 * Phase 1 — PR creation.
 *
 * Validates that branch + issue are present (returns `PR_FAILED_EXIT` if not),
 * pushes the branch, opens or surfaces a PR, enables auto-merge / converts a
 * draft to ready, and returns success. The worker performs NO conflict or CI
 * recovery — once the PR is open the ticket is marked done and the scheduler
 * watcher (`prRecovery.*`) owns all recovery.
 *
 * Returns an effective exit code: 0 on success, PR_FAILED_EXIT on failure.
 */
export async function runPrPhase(input: PrPhaseInput, deps: PrPhaseDeps): Promise<number> {
  const { changeName, cwd, branch, changeDir, stateFilePath, issue, wantAutoMerge, cfg } = input;
  const { cmd, log, emit, respawnWorker, registerPr, onPrReady, resolveDependencyBaseBranch } =
    deps;

  if (!branch || !issue) {
    log(
      `! createPr requested but no worktree branch is tracked for ${changeName} (use --worktree)`,
      "yellow",
    );
    return PR_FAILED_EXIT;
  }

  const labelBase = baseBranchFromLabels(issue.labels);
  let base = labelBase ?? cfg.prBaseBranch;
  let stackedOn: DependencyBase | undefined;
  if (labelBase && labelBase !== cfg.prBaseBranch) {
    log(`  base branch override from label: ${labelBase}`, "gray");
  } else if (cfg.stackPrsOnDependencies && resolveDependencyBaseBranch) {
    try {
      const dependencyBase = await resolveDependencyBaseBranch(issue);
      if (dependencyBase && dependencyBase.baseBranch !== base) {
        stackedOn = dependencyBase;
        base = dependencyBase.baseBranch;
        const blocker = dependencyBase.blockerIdentifier ?? "blocker";
        const prRef = dependencyBase.prNumber ? `PR #${dependencyBase.prNumber}` : "blocker PR";
        log(
          `  🥞 stacked PR: ${issue.identifier} → based on ${blocker} ${prRef} ` +
            `(${dependencyBase.prUrl}); base branch \`${base}\``,
          "cyan",
        );
        emit("stacked-pr", `${blocker} ${prRef} → ${base}`);
      }
    } catch (err) {
      log(
        `! could not resolve dependency base branch for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  const ctx: PostTaskCtx = {
    changeName,
    cwd,
    branch,
    base,
    ...(stackedOn ? { stackedOn } : {}),
    changeDir,
    stateFilePath,
    cfg,
    cmd,
    log,
    emit,
    respawnWorker,
  };

  try {
    const status = await cmd.run(["git", "status", "--porcelain"], cwd);
    const summary = summarizeUncommittedStatus(status.stdout);
    if (summary.count > 0) {
      const existingPrUrl = branch ? await findExistingOpenPrUrl(cmd, cwd, branch) : null;
      const indented = summary.preview.map((line) => `    ${line}`).join("\n");
      const suffix = summary.truncated ? `\n    ... and ${summary.truncated} more` : "";
      if (existingPrUrl) {
        log(
          `  ${changeName}: ${summary.count} uncommitted file(s) after worker — will retry next iteration:\n${indented}${suffix}`,
          "gray",
        );
      } else {
        log(
          `! ${changeName} has uncommitted changes after worker exit — the agent should commit everything before finishing. These changes will not be included in the PR:\n${indented}${suffix}`,
          "yellow",
        );
      }
    }
  } catch (err) {
    log(`! git status check failed for ${changeName}: ${(err as Error).message}`, "yellow");
  }

  const violations = await findNeverTouchViolations(cmd, cwd, base, cfg.neverTouch);
  if (violations.length > 0) {
    log(`! ${changeName} modified files inside boundaries.never_touch — aborting PR:`, "red");
    for (const v of violations) {
      log(`    ${v.file} (matched: ${v.pattern})`, "red");
    }
    return PR_FAILED_EXIT;
  }

  const maxOuterAttempts = MAX_PR_CREATE_ATTEMPTS;
  let onlyMetaAttempts = 0;
  let pr: Awaited<ReturnType<typeof createPullRequest>> = null;
  const finalizeNoOpAsDone = cfg.finalizeNoOpAsDone !== false;
  while (true) {
    const attempt = await createPrWithRetry(ctx, issue);
    if (attempt.gaveUp) return PR_FAILED_EXIT;
    if (attempt.pr?.blocked === "no-op" && finalizeNoOpAsDone) {
      const files = attempt.pr.blockedFiles ?? [];
      emit("pr-skipped-noop", `${files.length} meta file(s)`);
      log(
        `  ${changeName}: branch touched only meta files across its whole history — ` +
          `the requested work appears already present on ${base} (or was a no-op). ` +
          `Finalizing as done without a PR.`,
        "yellow",
      );
      for (const f of files) log(`    ${f}`, "gray");
      return NO_CHANGES_EXIT;
    }
    // When finalizeNoOpAsDone is disabled, a "no-op" branch falls through to
    // the legacy reapply-then-quarantine path below alongside "only-meta".
    if (attempt.pr?.blocked === "only-meta" || attempt.pr?.blocked === "no-op") {
      onlyMetaAttempts += 1;
      const files = attempt.pr.blockedFiles ?? [];
      emit("pr-only-meta", `${files.length} meta file(s)`);
      log(
        `! ${changeName}: branch diff against ${base} contains only meta files — implementation appears lost. Refusing to open PR.`,
        "red",
      );
      for (const f of files) log(`    ${f}`, "red");
      if (onlyMetaAttempts > maxOuterAttempts) {
        log(
          `! exceeded ${maxOuterAttempts} only-meta recovery attempts for ${changeName} — giving up`,
          "red",
        );
        return PR_FAILED_EXIT;
      }
      const fileList = files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "(empty diff)";
      const retryCode = await runWorkerWithFixTask(
        ctx,
        "Reapply lost implementation files",
        [
          `The diff against \`${base}\` contains only meta files`,
          `(openspec/tasks.md and similar). The substantive implementation`,
          `is missing from the branch — likely deleted by an earlier commit`,
          `or absorbed by a merge from origin/${base}.`,
          "",
          `Files currently in the diff:`,
          fileList,
          "",
          `Re-apply the actual implementation work the change is supposed`,
          `to ship. Inspect git history (\`git log ${base}..HEAD\`) to see`,
          `what was created earlier and lost, then restore those files`,
          `(or reproduce the work). Commit the restored files so the next`,
          `iteration's diff against \`${base}\` contains real code, not`,
          `just meta files.`,
        ].join("\n"),
      );
      if (retryCode !== 0) {
        log(`! worker re-run after only-meta block exited code ${retryCode} — giving up`, "red");
        return PR_FAILED_EXIT;
      }
      continue; // re-check the diff after the recovery iteration
    }
    pr = attempt.pr;
    break;
  }
  if (!pr) {
    // If the worktree still has uncommitted edits, the worker exited with
    // stranded work and there is nothing to PR because nothing was committed —
    // NOT because the change is a legitimate no-op. Returning 0 here would
    // cause the caller to post a Linear completion comment and flip the issue
    // to a done state with no PR (see LIT-303 incident).
    let dirtyAfterWorker = false;
    try {
      const status = await cmd.run(["git", "status", "--porcelain"], cwd);
      dirtyAfterWorker = summarizeUncommittedStatus(status.stdout).count > 0;
    } catch {
      // If we can't check, fall back to the legacy benign behavior.
    }
    if (dirtyAfterWorker) {
      log(
        `! ${changeName}: worker exited with uncommitted changes and no commits ahead of ${base} — refusing to mark done`,
        "red",
      );
      return PR_FAILED_EXIT;
    }
    log(`  no commits ahead of ${base} — skipping PR`, "gray");
    return 0;
  }
  const prUrl = pr.url;
  if (!prUrl) {
    log(`! PR creation returned a null URL for ${changeName} — giving up`, "red");
    return PR_FAILED_EXIT;
  }

  log(`  ${pr.created ? "opened" : "found existing"} PR: ${prUrl}`, "green");
  registerPr?.(changeName, prUrl);

  // Convert a draft PR to ready first — no CI wait needed. From here GitHub's
  // own auto-merge (and the scheduler watcher) handle CI; the worker is done.
  let readyOk = true;
  if (cfg.prDraft === true) {
    emit("pr-ready");
    try {
      await cmd.run(["gh", "pr", "ready", prUrl], cwd);
      log(`  converted ${prUrl} from draft to ready`, "green");
    } catch (err) {
      const e = err as Error & { stderr?: string };
      log(`! gh pr ready failed for ${prUrl}: ${e.stderr?.trim() || e.message}`, "yellow");
      readyOk = false;
    }
  }

  // A draft that could not be converted to ready can't be auto-merged — skip it.
  if (wantAutoMerge && readyOk) {
    const repoAllowsAutoMerge = await detectRepoAutoMergeAllowed(prUrl, cmd, cwd, log);
    if (repoAllowsAutoMerge === false) {
      // RLF-97: the worker no longer polls CI in-process, so it can't merge a
      // repo with auto-merge disabled "once checks pass". Leave the PR open for
      // a human / repo settings to merge instead of merging speculatively now.
      log(
        cfg.manualMergeWhenAutoMergeDisabled !== false
          ? `  repo has auto-merge disabled — leaving ${prUrl} open for manual merge once checks pass`
          : `  repo has auto-merge disabled (manual-merge fallback off) — ${prUrl} will not auto-merge`,
        "yellow",
      );
    } else {
      try {
        await cmd.run(["gh", "pr", "merge", prUrl, "--auto", `--${cfg.autoMergeStrategy}`], cwd);
        log(`  enabled auto-merge (${cfg.autoMergeStrategy}) on ${prUrl}`, "green");
        emit("auto-merge-enabled", cfg.autoMergeStrategy);
      } catch (err) {
        const e = err as Error & { stderr?: string };
        log(
          `! failed to enable auto-merge on ${prUrl}: ${e.stderr?.trim() || e.message}`,
          "yellow",
        );
      }
    }
  }

  // Additive `setPrReady`: the PR is pushed, surfaced, and (if a draft)
  // converted to ready. With auto-merge now GitHub-side, the PR sits reviewable
  // until its checks pass, so always surface it as ready-for-review.
  await onPrReady?.(prUrl);

  return 0;
}

/** Inputs consumed only by the worktree cleanup phase. */
interface WorktreeCleanupPhaseInput {
  changeName: string;
  cwd: string;
  projectRoot: string;
  useWorktree: boolean;
  effectiveCode: number;
  cfg: Pick<PostTaskInput["cfg"], "cleanupWorktreeOnSuccess" | "prBaseBranch">;
}

/** Deps consumed only by the worktree cleanup phase. */
interface WorktreeCleanupPhaseDeps {
  git: GitRunner;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
}

/**
 * Phase 2 — worktree cleanup.
 *
 * Removes the task worktree only when the run fully succeeded and
 * `cleanupWorktreeOnSuccess` is set. A pre-removal safety check refuses to
 * delete a worktree that still has uncommitted files or unpushed commits, so
 * human-inspectable state is never silently lost.
 *
 * Failed runs always keep their worktree and branch for human inspection on
 * the existing PR.
 */
export async function runWorktreeCleanupPhase(
  input: WorktreeCleanupPhaseInput,
  deps: WorktreeCleanupPhaseDeps,
): Promise<void> {
  const { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg } = input;
  const { git, log, emit } = deps;

  if (!useWorktree || cwd === projectRoot) return;

  emit("cleanup", "checking worktree safety");

  if (effectiveCode !== 0 || !cfg.cleanupWorktreeOnSuccess) return;

  // Strict pre-removal guard: never `git worktree remove --force` a worktree
  // that still has uncommitted files or commits not yet pushed/PR'd — `--force`
  // would destroy them silently.
  const check = await isWorktreeSafeToRemove(cwd, cfg.prBaseBranch, git).catch((err) => ({
    safe: false as const,
    reason: `safety check failed: ${(err as Error).message}`,
    dirty: "",
    unpushedCommits: "",
  }));

  if (!check.safe) {
    log(`! preserving worktree for ${changeName}: ${check.reason}`, "yellow");
    if (check.dirty) log(`    uncommitted:\n${check.dirty}`, "yellow");
    if (check.unpushedCommits) log(`    commits:\n${check.unpushedCommits}`, "yellow");
    log(`    path: ${cwd}`, "yellow");
    return;
  }

  try {
    await runCapability(gitCap.removeWorktree, { projectRoot, cwd, runner: git });
    log(`  removed worktree ${cwd}`, "gray");
  } catch (err) {
    log(`! worktree remove failed for ${changeName}: ${(err as Error).message}`, "yellow");
  }
}

/** Inputs consumed only by the teardown phase. */
interface TeardownPhaseInput {
  cwd: string;
  teardownScript: string | null;
}

/** Deps consumed only by the teardown phase. */
interface TeardownPhaseDeps {
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
}

/**
 * Phase 3 — teardown script.
 *
 * Runs after both the worker and any post-task CI/PR work, and after worktree
 * cleanup. Fires on both success and failure, so artifacts can be gathered and
 * local mutations rolled back regardless of outcome. Failures are logged and
 * never block the caller.
 */
export async function runTeardownPhase(
  input: TeardownPhaseInput,
  deps: TeardownPhaseDeps,
): Promise<void> {
  const { cwd, teardownScript } = input;
  const { runScript, log, emit } = deps;

  if (!teardownScript) return;

  emit("teardown", teardownScript);
  try {
    await runScript("teardown", teardownScript, cwd);
  } catch (err) {
    log(`! teardown script threw: ${(err as Error).message}`, "yellow");
  }
}

// ---------------------------------------------------------------------------
// Validate-only phase — runs after worker exits when `wantValidateOnly` is
// set. Runs configured check commands; on failure injects a fix task and
// respawns the worker. On success (or when no commands are configured)
// injects a "run openspec validate" task so the agent finalises the change.
// ---------------------------------------------------------------------------

interface ValidateOnlyInput {
  changeName: string;
  changeDir: string;
  stateFilePath: string;
  validateCommands: string[];
  cwd: string;
}

interface ValidateOnlyDeps {
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
  /**
   * Run a shell command string; resolve with exit code and combined output.
   * Defaults to `sh -c <cmd>` via Bun.spawnSync when not provided.
   */
  runCommand?: (cmd: string, cwd: string) => Promise<{ exitCode: number; output: string }>;
}

const defaultRunCommand = async (
  cmd: string,
  cwd: string,
): Promise<{ exitCode: number; output: string }> => {
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", cmd],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  const output = [decoder.decode(proc.stdout), decoder.decode(proc.stderr)]
    .filter(Boolean)
    .join("\n");
  return { exitCode: proc.exitCode ?? 1, output };
};

/**
 * Phase: validate-only.
 *
 * Runs when the agent app spawns a worker with `--validate-on-complete`
 * (i.e. `wantValidateOnly` is true) and the worker exits with code 0.
 *
 * 1. If `validateCommands` is empty → inject a "run openspec validate" task
 *    directly (straight to validation).
 * 2. Otherwise run each command in order:
 *    - First failure → emit `"validate-fix"`, inject a fix task, respawn.
 *    - All pass → inject the "run openspec validate" task, respawn.
 */
export async function runValidateOnlyPhase(
  input: ValidateOnlyInput,
  deps: ValidateOnlyDeps,
): Promise<number> {
  const { changeName, changeDir, stateFilePath, validateCommands, cwd } = input;
  const { log, emit, respawnWorker } = deps;
  const runCommand = deps.runCommand ?? defaultRunCommand;

  emit("validate");

  if (validateCommands.length > 0) {
    for (const command of validateCommands) {
      const { exitCode, output } = await runCommand(command, cwd);
      if (exitCode !== 0) {
        emit("validate-fix", command);
        log(`! validation check failed: ${command}`, "yellow");
        try {
          await prependFixTask(
            join(changeDir, AGENT_TASKS_FILENAME),
            `Fix failing validation: ${command}`,
            output || `Command exited with code ${exitCode}`,
          );
        } catch (err) {
          log(`! could not prepend fix task: ${(err as Error).message}`, "red");
          return 1;
        }
        await reactivateState(stateFilePath, log, changeName);
        return respawnWorker();
      }
    }
  }

  // No commands, or all commands passed → inject the openspec validation task.
  try {
    await prependFixTask(
      join(changeDir, AGENT_TASKS_FILENAME),
      "Run openspec validation",
      [
        `Run \`bunx openspec validate ${changeName}\` to validate the change artifacts.`,
        `Commit any pending changes before running the validation command.`,
      ].join("\n"),
    );
  } catch (err) {
    log(`! could not prepend validation task: ${(err as Error).message}`, "red");
    return 1;
  }
  await reactivateState(stateFilePath, log, changeName);
  return respawnWorker();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Orchestrate everything that happens after the worker subprocess exits.
 * The flow mirrors the agent mode diagram exactly:
 *
 *  Phase 1 (PR) — on success + `wantPr`: push, open/surface a PR, then run
 *    the conflict + CI fix loop until checks are green or attempts run out.
 *  Phase 2 (cleanup) — on success + `useWorktree`: safely remove the worktree.
 *  Phase 3 (teardown) — always: run `teardownScript` if configured.
 *
 * Returns an "effective" exit code: the worker's own code, overridden to
 * `PR_FAILED_EXIT` or `CI_FAILED_EXIT` when post-task work fails. The
 * coordinator uses this to decide whether to mark the issue processed.
 */
/**
 * Bump the durable per-change give-up tally when a worker gives up. Writes a
 * single-integer sidecar (`GAVEUP_COUNT_FILE`) beside `.ralph-state.json`
 * rather than mutating the state file itself: the state file has concurrent
 * async writers (loop, confirmation gate) that a second read-modify-write
 * would clobber. The sidecar has exactly one writer (this function, one worker
 * per change), so the plain read-add-write needs no locking.
 */
async function recordGaveUp(
  stateFilePath: string,
  log: PostTaskDeps["log"],
  changeName: string,
): Promise<void> {
  const path = join(dirname(stateFilePath), GAVEUP_COUNT_FILE);
  try {
    const file = Bun.file(path);
    const current = (await file.exists()) ? Number.parseInt(await file.text(), 10) || 0 : 0;
    await Bun.write(path, String(current + 1) + "\n");
  } catch (err) {
    log(`! could not record gave-up for ${changeName}: ${(err as Error).message}`, "yellow");
  }
}

export async function runPostTask(input: PostTaskInput, deps: PostTaskDeps): Promise<number> {
  const { log, cmd, git, runScript } = deps;
  const emit = (phase: PostTaskPhase, detail?: string) => deps.onPhase?.(phase, detail);
  const {
    changeName,
    cwd,
    projectRoot,
    changeDir,
    stateFilePath,
    branch,
    issue,
    exitCode,
    useWorktree,
    wantPr,
    wantAutoMerge,
    wantValidateOnly,
    cfg,
    respawnWorker,
  } = input;

  // Registry walk: let per-feature slices run their post-task tail
  // alongside the legacy phases. Stub features have no `postTask`, so
  // this is a no-op until a slice migrates. Walk runs even when the
  // worker exited non-zero so failure-handling slices (e.g. stuck) can
  // see the exit code.
  if (deps.buildFeatureCtx && issue) {
    const ctx = deps.buildFeatureCtx(issue);
    if (ctx) {
      const result = { exitCode, branch };
      for (const feature of featureRegistry) {
        await runFeaturePostTask(feature, ctx, result);
      }
    }
  }

  // Validate-only phase: run check commands and inject the openspec validation
  // task instead of creating a PR.
  let effectiveCode = exitCode;
  if (wantValidateOnly && effectiveCode === 0) {
    effectiveCode = await runValidateOnlyPhase(
      {
        changeName,
        changeDir,
        stateFilePath,
        validateCommands: cfg.validateCommands ?? [],
        cwd,
      },
      {
        log,
        emit,
        respawnWorker,
      },
    );
    emit(
      effectiveCode === 0 ? "done" : "gave-up",
      effectiveCode !== 0 ? `exit ${effectiveCode}` : undefined,
    );
    if (effectiveCode !== 0) await recordGaveUp(stateFilePath, log, changeName);
    await runWorktreeCleanupPhase(
      { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg },
      { git, log, emit },
    );
    await runTeardownPhase({ cwd, teardownScript: cfg.teardownScript }, { runScript, log, emit });
    return effectiveCode;
  }

  // Phase 1: PR creation + CI/conflict watch
  if (effectiveCode !== 0 && wantPr) {
    log(`  skipping PR phase for ${changeName} (worker exited with code ${effectiveCode})`, "gray");
  }

  // RLF-82: conflict-fix verify-only short-circuit. The worker iteration
  // owns the push (see `wire/prepare.ts::prepareTaskForTrigger`), so this
  // branch never invokes `git push` or `createPrWithRetry`. It only verifies
  // the PR's current mergeability via a single `fetchPrStatus` call and reacts
  // to the outcome (clearConflicted on MERGEABLE; leave label in place otherwise).
  if (input.mode === "conflict-fix" && effectiveCode === 0) {
    const identifier = issue?.identifier ?? changeName;

    // Push-landed guard. In conflict-fix mode the worker owns the push (see
    // `wire/prepare.ts::prepareTaskForTrigger`); the harness never pushes here.
    // If the worker resolved + committed but never pushed (or the push silently
    // failed), the local branch is ahead of `origin/<branch>` while the PR head
    // stays frozen. The mergeability probe below only inspects GitHub's view of
    // the *remote* head, so it would report this iteration a success, the
    // coordinator would post "resolved merge conflicts", and the next poll would
    // re-detect the same CONFLICTING PR — burning recovery attempts until the
    // PR-tracker bails to `ralph:error`, then looping forever. Detect the
    // unpushed divergence and fail the iteration so the "resolved" signal is
    // honest. (The remote-tracking ref is updated by a successful push, so this
    // needs no fetch.)
    if (branch) {
      let aheadCount = 0;
      let checked = true;
      try {
        const r = await cmd.run(["git", "rev-list", "--count", `origin/${branch}..HEAD`], cwd);
        aheadCount = Number.parseInt(r.stdout.trim(), 10) || 0;
      } catch (err) {
        // Ref missing / detached HEAD / not a worktree — can't determine, so
        // don't block: fall through to the existing mergeability verification.
        checked = false;
        log(
          `! ${identifier}: could not check for unpushed conflict-fix commits: ${(err as Error).message}`,
          "yellow",
        );
      }
      if (checked && aheadCount > 0) {
        log(
          `! ${identifier}: conflict-fix worker left ${aheadCount} unpushed commit(s) ahead of ` +
            `origin/${branch} — the resolution never reached the PR. Failing the iteration so it ` +
            `is retried instead of reported as resolved.`,
          "red",
        );
        emit("gave-up", "unpushed conflict resolution");
        await recordGaveUp(stateFilePath, log, changeName);
        await runWorktreeCleanupPhase(
          { changeName, cwd, projectRoot, useWorktree, effectiveCode: PR_FAILED_EXIT, cfg },
          { git, log, emit },
        );
        await runTeardownPhase(
          { cwd, teardownScript: cfg.teardownScript },
          { runScript, log, emit },
        );
        return PR_FAILED_EXIT;
      }
    }

    let prUrl: string | null = input.prUrl ?? null;
    if (!prUrl && branch) {
      prUrl = await findExistingOpenPrUrl(cmd, cwd, branch);
    }
    if (!prUrl) {
      log(
        `  ${identifier}: no open PR found for conflict-fix verification — nothing to verify`,
        "yellow",
      );
    } else {
      // Widen to the union explicitly — TS narrows from the initial
      // assignment and otherwise won't see closure mutations inside `probe`.
      let status: PrStatus = { kind: "error", message: "no probe ran" } as PrStatus;
      const outcome = await waitForMergeability({
        ...(deps._mergeabilityBackoffsMs !== undefined
          ? { backoffsMs: deps._mergeabilityBackoffsMs }
          : {}),
        bailOnError: true,
        probe: async () => {
          status = await fetchPrStatus(prUrl, cmd, cwd);
          if (status.kind === "error") throw new Error(status.message);
          return { state: status.state, mergeable: status.mergeable };
        },
      });
      // Synthesize a `status` for the log decision below from the outcome.
      // `status` closes over each probe attempt's result; `outcome` adds
      // the post-loop decision (e.g. mergeStateStatus=CLEAN can flip
      // mergeable=UNKNOWN to "mergeable"), so reconcile the two here.
      if (outcome.kind === "error") {
        status = { kind: "error", message: outcome.message };
      } else if (status.kind === "ok") {
        if (outcome.kind === "mergeable") {
          status = { ...status, mergeable: "MERGEABLE" };
        } else if (outcome.kind === "conflicting") {
          status = { ...status, mergeable: "CONFLICTING" };
        }
        // outcome.kind === "closed" or "unknown" → leave mergeable as-is
        // so the "still UNKNOWN" log fires.
      }
      if (status.kind === "ok" && status.mergeable === "MERGEABLE") {
        log(`  ${identifier}: PR ${prUrl} is MERGEABLE after rebase`, "green");
      } else if (status.kind === "ok" && status.mergeable === "CONFLICTING") {
        log(`! ${identifier}: still CONFLICTING after rebase; will retry`, "yellow");
      } else if (status.kind === "ok") {
        log(
          `! ${identifier}: PR mergeability is UNKNOWN — next poll will re-check from GitHub`,
          "yellow",
        );
      } else {
        log(
          `! ${identifier}: PR status fetch failed (${status.message}) — next poll will re-check`,
          "yellow",
        );
      }
    }
    emit("done");
    await runWorktreeCleanupPhase(
      { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg },
      { git, log, emit },
    );
    await runTeardownPhase({ cwd, teardownScript: cfg.teardownScript }, { runScript, log, emit });
    return effectiveCode;
  }

  if (effectiveCode === 0 && wantPr) {
    effectiveCode = await runPrPhase(
      {
        changeName,
        cwd,
        branch,
        changeDir,
        stateFilePath,
        issue,
        wantAutoMerge,
        cfg,
      },
      {
        cmd,
        log,
        emit,
        respawnWorker,
        ...(deps.registerPr !== undefined ? { registerPr: deps.registerPr } : {}),
        ...(deps.onPrReady !== undefined ? { onPrReady: deps.onPrReady } : {}),
        ...(deps.resolveDependencyBaseBranch !== undefined
          ? { resolveDependencyBaseBranch: deps.resolveDependencyBaseBranch }
          : {}),
      },
    );
  }

  // NO_CHANGES_EXIT is a successful "nothing to ship" outcome, not a failure:
  // surface it as done on the dashboard, not "gave-up".
  const succeeded = effectiveCode === 0 || effectiveCode === NO_CHANGES_EXIT;
  emit(succeeded ? "done" : "gave-up", succeeded ? undefined : `exit ${effectiveCode}`);
  if (!succeeded) await recordGaveUp(stateFilePath, log, changeName);

  // Retrospective (opt-in, --agent-debug): runs before worktree cleanup so the
  // worktree artifacts + state file are still readable. The dep never throws;
  // `effectiveCode` is left unchanged.
  await deps.runRetrospective?.({
    changeName,
    cwd,
    changeDir,
    stateFilePath,
    branch,
    issue,
    effectiveCode,
  });

  // Phase 2: worktree cleanup
  await runWorktreeCleanupPhase(
    { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg },
    { git, log, emit },
  );

  // Phase 3: teardown script
  await runTeardownPhase({ cwd, teardownScript: cfg.teardownScript }, { runScript, log, emit });

  return effectiveCode;
}
