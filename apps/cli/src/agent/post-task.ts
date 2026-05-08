import { join } from "node:path";
import { prependFixTask } from "@ralphy/core/tasks-md";
import type { LinearIssue } from "./linear";
import type { GitRunner } from "./worktree";
import type { CmdRunner } from "./pr";
import { createPullRequest } from "./pr";
import { fixCiUntilGreen, getPrChecksStatus, fetchFailedRunLogs } from "./ci";
import { isWorktreeSafeToRemove, removeWorktree } from "./worktree";

/** Worker exited 0 but the CI fix loop never reached green. */
const CI_FAILED_EXIT = 70;
/** Worker exited 0 but the residual-commit / push / PR-create path failed. */
const PR_FAILED_EXIT = 71;

interface PostTaskInput {
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
  wantFixCi: boolean;
  cfg: {
    teardownScript: string | null;
    prBaseBranch: string;
    maxCiFixAttempts: number;
    ciPollIntervalSeconds: number;
    cleanupWorktreeOnSuccess: boolean;
    ignoreCiChecks: string[];
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
  | "rebasing"
  | "pr-create"
  | "conflict-check"
  | "conflict-fix-inner"
  | "ci-poll"
  | "ci-fix"
  | "cleanup"
  | "done"
  | "gave-up"
  | "teardown";

interface PostTaskDeps {
  cmd: CmdRunner;
  git: GitRunner;
  log: (text: string, color?: string) => void;
  /** Run a shell command and surface non-zero exit via `log`, never throw. */
  runScript: (label: string, cmd: string, cwd: string) => Promise<void>;
  /** Optional: record the URL of the PR opened (or surfaced) for this
   *  changeName. Used by the agent coordinator's conflict-scan to know
   *  which changes to check for merge conflicts on subsequent polls. */
  registerPr?: (changeName: string, prUrl: string) => void;
  /** Optional phase emitter — surfaced in the dashboard footer. */
  onPhase?: (phase: PostTaskPhase, detail?: string) => void;
  /**
   * Optional: check whether a PR currently has merge conflicts.
   * When provided, the post-task loop re-checks conflicts after each CI fix
   * cycle and resolves them in-place rather than waiting for the coordinator
   * to detect them on the next poll.
   */
  checkPrConflict?: (prUrl: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Shared context bundled once and threaded into helpers below.
// ---------------------------------------------------------------------------

interface PostTaskCtx {
  changeName: string;
  cwd: string;
  branch: string;
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
    await prependFixTask(join(ctx.changeDir, "tasks.md"), heading, body);
  } catch (err) {
    ctx.log(`! could not prepend fix task: ${(err as Error).message}`, "red");
    return 1;
  }
  await reactivateState(ctx.stateFilePath, ctx.log, ctx.changeName);
  return ctx.respawnWorker();
}

/**
 * Push the branch to origin. If the push is rejected as non-fast-forward
 * (e.g. after a rebase rewrote history), fall back to --force-with-lease,
 * which still refuses if someone else pushed to the branch since our last
 * fetch.
 *
 * Returns true on success, false on failure (failure is already logged).
 */
async function pushWithLeases(ctx: PostTaskCtx): Promise<boolean> {
  try {
    ctx.emit("pushing", "after conflict resolution");
    await ctx.cmd.run(["git", "push", "origin", ctx.branch], ctx.cwd);
    return true;
  } catch (pushErr) {
    const pe = pushErr as Error & { stderr?: string };
    const blob = `${pe.message}\n${pe.stderr ?? ""}`;
    if (!/non-fast-forward|Updates were rejected/i.test(blob)) {
      ctx.log(`! push after conflict fix failed: ${pe.message}`, "red");
      return false;
    }
    try {
      await ctx.cmd.run(["git", "push", "--force-with-lease", "origin", ctx.branch], ctx.cwd);
      return true;
    } catch (forceErr) {
      ctx.log(`! force-push after conflict fix failed: ${(forceErr as Error).message}`, "red");
      return false;
    }
  }
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
  const maxAttempts = ctx.cfg.maxCiFixAttempts;
  let hookFixAttempt = 0;
  let nonFfRebaseAttempted = false;
  let pr: Awaited<ReturnType<typeof createPullRequest>> = null;

  while (true) {
    try {
      ctx.emit("pr-create", "git push + gh pr create");
      pr = await createPullRequest(
        { cwd: ctx.cwd, branch: ctx.branch, issue, base: ctx.cfg.prBaseBranch },
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
        ctx.emit("rebasing", `git pull --rebase origin ${ctx.branch}`);
        ctx.log(
          `  non-fast-forward push for ${ctx.changeName} — rebasing onto origin/${ctx.branch}`,
          "yellow",
        );
        try {
          await ctx.cmd.run(["git", "fetch", "origin", ctx.branch], ctx.cwd);
          await ctx.cmd.run(["git", "pull", "--rebase", "origin", ctx.branch], ctx.cwd);
          continue;
        } catch (rebaseErr) {
          const re = rebaseErr as Error & { stderr?: string; stdout?: string };
          const reBlob = `${re.stdout ?? ""}\n${re.stderr ?? ""}`;
          const isConflict = /CONFLICT|Merge conflict|could not apply|both modified/i.test(reBlob);
          if (!isConflict) {
            ctx.log(
              `! rebase failed for ${ctx.changeName}: ${(rebaseErr as Error).message} — giving up`,
              "red",
            );
            return { pr: null, gaveUp: true };
          }

          ctx.emit("rebasing", "conflicts detected — aborting + queueing fix task");
          try {
            await ctx.cmd.run(["git", "rebase", "--abort"], ctx.cwd);
          } catch (err) {
            ctx.log(
              `! git rebase --abort failed (worktree may already be clean): ${(err as Error).message}`,
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
              `! merge conflict on rebase of ${ctx.branch} after ${hookFixAttempt} attempts — worktree preserved at ${ctx.cwd}`,
              "red",
            );
            ctx.log(`    detail: ${reBlob.trim().split("\n").slice(0, 8).join("\n")}`, "red");
            return { pr: null, gaveUp: true };
          }

          hookFixAttempt += 1;
          ctx.emit("rebasing", `conflict-fix ${hookFixAttempt}/${maxAttempts}`);
          ctx.log(
            `! merge conflict rebasing ${ctx.branch} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxAttempts})`,
            "yellow",
          );

          const retryCode = await runWorkerWithFixTask(
            ctx,
            "Resolve merge conflict with origin/" + ctx.branch,
            `Push to origin/${ctx.branch} was rejected as non-fast-forward, and rebasing ` +
              `onto origin/${ctx.branch} produced merge conflicts.\n\n` +
              `Run \`git fetch origin ${ctx.branch}\` and \`git rebase origin/${ctx.branch}\`, ` +
              `resolve every conflict, \`git add\` the resolved files, and finish with ` +
              `\`git rebase --continue\`. The push will be retried after this loop ` +
              `iteration finishes.\n\n` +
              (conflictedFiles
                ? `Files that differ between your branch and origin/${ctx.branch}:\n${conflictedFiles}\n\n`
                : "") +
              `Rebase output:\n${reBlob.trim()}`,
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
          combined.trim(),
      );
      if (retryCode !== 0) {
        ctx.log(`! worker re-run after push rejection exited code ${retryCode} — giving up`, "red");
        return { pr: null, gaveUp: true };
      }
    }
  }
}

/**
 * Outer loop that alternates between conflict resolution and CI polling until
 * the PR is both conflict-free and CI-green, or the attempt budget runs out.
 *
 * Budget: each conflict-fix cycle consumes one outer attempt counter. The CI
 * fix loop inside gets its own fresh maxAttempts budget per cycle so a
 * multi-attempt CI fix doesn't starve the conflict-re-check path.
 *
 * Returns an effective exit code: 0 on success, CI_FAILED_EXIT or
 * PR_FAILED_EXIT on failure.
 */
async function fixConflictsAndCiLoop(
  ctx: PostTaskCtx,
  prUrl: string,
  wantFixCi: boolean,
  checkPrConflict: ((url: string) => Promise<boolean>) | undefined,
): Promise<number> {
  const wantConflictLoop = !!checkPrConflict;
  const maxOuterAttempts = ctx.cfg.maxCiFixAttempts;
  let outerAttempt = 0;
  let ciConfirmedGreen = false;

  while (outerAttempt < maxOuterAttempts) {
    // Step 1: check whether the PR has merge conflicts.
    if (wantConflictLoop) {
      ctx.emit("conflict-check");
      let conflicting = false;
      try {
        conflicting = await checkPrConflict!(prUrl);
      } catch (err) {
        ctx.log(`! conflict check failed: ${(err as Error).message}`, "yellow");
      }

      if (conflicting) {
        outerAttempt++;
        ciConfirmedGreen = false;
        ctx.emit("conflict-fix-inner", `attempt ${outerAttempt}/${maxOuterAttempts}`);
        ctx.log(
          `  merge conflicts on PR (attempt ${outerAttempt}/${maxOuterAttempts}) — spawning resolution task`,
          "yellow",
        );

        const conflictCode = await runWorkerWithFixTask(
          ctx,
          "Resolve PR merge conflicts",
          [
            `The PR ${prUrl} has merge conflicts with \`${ctx.cfg.prBaseBranch}\`.`,
            "",
            "Steps:",
            `1. \`git fetch origin ${ctx.cfg.prBaseBranch}\` then rebase or merge \`${ctx.cfg.prBaseBranch}\` into the current branch.`,
            "2. Resolve conflicts in the files git lists.",
            "3. Stage and commit the resolution.",
          ].join("\n"),
        );
        if (conflictCode !== 0) {
          ctx.log(`! conflict resolution worker exited code ${conflictCode} — giving up`, "red");
          return PR_FAILED_EXIT;
        }

        // Push the resolved branch. If the worker rebased (rewrote history),
        // the regular push fails as non-fast-forward; pushWithLeases falls
        // back to --force-with-lease which still refuses if someone else
        // pushed to the branch concurrently.
        const pushed = await pushWithLeases(ctx);
        if (!pushed) return PR_FAILED_EXIT;

        continue; // re-enter loop to re-check conflicts before CI
      }
    }

    // Step 2: poll CI until green (or budget exhausted).
    if (!wantFixCi) break; // conflict-check-only mode: no conflicts → done

    if (!ciConfirmedGreen) {
      ctx.log(`  watching CI for ${prUrl} (max ${ctx.cfg.maxCiFixAttempts} fix attempts)`, "gray");
      ctx.emit("ci-poll", "starting");

      const result = await fixCiUntilGreen(
        {
          onPhase: (p, d) => ctx.emit(p as PostTaskPhase, d),
          getStatus: () =>
            getPrChecksStatus(
              prUrl,
              ctx.cmd,
              ctx.cwd,
              (n, ms, why) =>
                ctx.log(
                  `  gh transient (try ${n}) — retry in ${Math.round(ms / 1000)}s · ${why}`,
                  "yellow",
                ),
              ctx.cfg.ignoreCiChecks,
            ),
          getFailedLogs: (ids) => fetchFailedRunLogs(ids, ctx.cmd, ctx.cwd),
          runTaskWithSteering: (steering) =>
            runWorkerWithFixTask(ctx, "Fix failing CI checks", steering),
          pushBranch: async () => {
            await ctx.cmd.run(["git", "push", "origin", ctx.branch], ctx.cwd);
          },
          log: ctx.log,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        },
        {
          maxAttempts: ctx.cfg.maxCiFixAttempts,
          pollIntervalSeconds: ctx.cfg.ciPollIntervalSeconds,
        },
      );

      if (!result.success) {
        ctx.log(
          `! CI fix loop gave up after ${result.attempts} attempts (${result.reason ?? "unknown"}) — withholding done-status until CI passes`,
          "red",
        );
        return CI_FAILED_EXIT;
      }
      ciConfirmedGreen = true;
    }

    // CI is green — do one final conflict scan (if enabled) to confirm the
    // PR is stable before declaring success.
    if (wantConflictLoop) {
      continue; // re-enter the conflict-check step at the top
    }
    return 0; // CI green and no conflict loop → done
  }

  if (outerAttempt >= maxOuterAttempts) {
    ctx.log(`! outer fix loop exhausted ${maxOuterAttempts} attempts — giving up`, "red");
    return CI_FAILED_EXIT;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Phase functions — each handles one step of the post-task flow and can be
// tested in isolation by passing minimal deps.
// ---------------------------------------------------------------------------

/** Inputs consumed only by the PR phase. */
export interface PrPhaseInput {
  changeName: string;
  cwd: string;
  branch: string | null;
  changeDir: string;
  stateFilePath: string;
  issue: LinearIssue | null;
  wantFixCi: boolean;
  cfg: PostTaskInput["cfg"];
}

/** Deps consumed only by the PR phase. */
export interface PrPhaseDeps {
  cmd: CmdRunner;
  log: (text: string, color?: string) => void;
  emit: (phase: PostTaskPhase, detail?: string) => void;
  respawnWorker: () => Promise<number>;
  registerPr?: (changeName: string, prUrl: string) => void;
  checkPrConflict?: (prUrl: string) => Promise<boolean>;
}

/**
 * Phase 1 — PR creation + CI/conflict watch loop.
 *
 * Validates that branch + issue are present (returns `PR_FAILED_EXIT` if not),
 * pushes the branch, opens or surfaces a PR, then runs `fixConflictsAndCiLoop`
 * until the PR is both conflict-free and CI-green.
 *
 * Returns an effective exit code: 0 on success, PR_FAILED_EXIT or
 * CI_FAILED_EXIT on failure.
 */
export async function runPrPhase(input: PrPhaseInput, deps: PrPhaseDeps): Promise<number> {
  const { changeName, cwd, branch, changeDir, stateFilePath, issue, wantFixCi, cfg } = input;
  const { cmd, log, emit, respawnWorker, registerPr, checkPrConflict } = deps;

  if (!branch || !issue) {
    log(
      `! createPr requested but no worktree branch is tracked for ${changeName} (use --worktree)`,
      "yellow",
    );
    return PR_FAILED_EXIT;
  }

  const ctx: PostTaskCtx = {
    changeName,
    cwd,
    branch,
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
    if (status.stdout.trim()) {
      log(
        `! ${changeName} has uncommitted changes after worker exit — the agent should commit everything before finishing. These changes will not be included in the PR.`,
        "yellow",
      );
    }
  } catch (err) {
    log(`! git status check failed for ${changeName}: ${(err as Error).message}`, "yellow");
  }

  const { pr, gaveUp: prGaveUp } = await createPrWithRetry(ctx, issue);
  if (prGaveUp) return PR_FAILED_EXIT;
  if (!pr) {
    log(`  no commits ahead of ${cfg.prBaseBranch} — skipping PR`, "gray");
    return 0;
  }

  log(`  ${pr.created ? "opened" : "found existing"} PR: ${pr.url}`, "green");
  registerPr?.(changeName, pr.url);

  return fixConflictsAndCiLoop(ctx, pr.url, wantFixCi, checkPrConflict);
}

/** Inputs consumed only by the worktree cleanup phase. */
export interface WorktreeCleanupPhaseInput {
  changeName: string;
  cwd: string;
  projectRoot: string;
  useWorktree: boolean;
  effectiveCode: number;
  cfg: Pick<PostTaskInput["cfg"], "cleanupWorktreeOnSuccess" | "prBaseBranch">;
}

/** Deps consumed only by the worktree cleanup phase. */
export interface WorktreeCleanupPhaseDeps {
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
    await removeWorktree(projectRoot, cwd, git);
    log(`  removed worktree ${cwd}`, "gray");
  } catch (err) {
    log(`! worktree remove failed for ${changeName}: ${(err as Error).message}`, "yellow");
  }
}

/** Inputs consumed only by the teardown phase. */
export interface TeardownPhaseInput {
  cwd: string;
  teardownScript: string | null;
}

/** Deps consumed only by the teardown phase. */
export interface TeardownPhaseDeps {
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
    wantFixCi,
    cfg,
    respawnWorker,
  } = input;

  // Phase 1: PR creation + CI/conflict watch
  let effectiveCode = exitCode;
  if (effectiveCode !== 0 && wantPr) {
    log(`  skipping PR phase for ${changeName} (worker exited with code ${effectiveCode})`, "gray");
  }
  if (effectiveCode === 0 && wantPr) {
    effectiveCode = await runPrPhase(
      { changeName, cwd, branch, changeDir, stateFilePath, issue, wantFixCi, cfg },
      {
        cmd,
        log,
        emit,
        respawnWorker,
        ...(deps.registerPr !== undefined ? { registerPr: deps.registerPr } : {}),
        ...(deps.checkPrConflict !== undefined ? { checkPrConflict: deps.checkPrConflict } : {}),
      },
    );
  }

  emit(
    effectiveCode === 0 ? "done" : "gave-up",
    effectiveCode !== 0 ? `exit ${effectiveCode}` : undefined,
  );

  // Phase 2: worktree cleanup
  await runWorktreeCleanupPhase(
    { changeName, cwd, projectRoot, useWorktree, effectiveCode, cfg },
    { git, log, emit },
  );

  // Phase 3: teardown script
  await runTeardownPhase({ cwd, teardownScript: cfg.teardownScript }, { runScript, log, emit });

  return effectiveCode;
}
