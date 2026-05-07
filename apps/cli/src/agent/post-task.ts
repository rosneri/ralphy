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
  | "teardown"
  | "committing"
  | "commit-retry"
  | "pushing"
  | "push-retry"
  | "rebasing"
  | "pr-create"
  | "ci-poll"
  | "ci-fix"
  | "cleanup"
  | "done"
  | "gave-up";

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
 * Orchestrate everything that happens after the worker subprocess exits:
 *
 *  1. Run the configured teardown script.
 *  2. On success + `wantPr`: commit residual changes (with hook-fix retry),
 *     create a PR (with push-rejection retry), and optionally run the CI
 *     fix loop until checks go green or the attempt budget runs out.
 *  3. On full success + `useWorktree`: safely remove the worktree.
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

  if (cfg.teardownScript) {
    emit("teardown", cfg.teardownScript);
    try {
      await runScript("teardown", cfg.teardownScript, cwd);
    } catch {
      /* runScript already logs */
    }
  }

  let effectiveCode = exitCode;
  const ok = exitCode === 0;

  if (ok && wantPr) {
    if (!branch || !issue) {
      log(
        `! createPr requested but no worktree branch is tracked for ${changeName} (use --worktree)`,
        "yellow",
      );
      effectiveCode = PR_FAILED_EXIT;
    } else {
      const maxHookFixAttempts = cfg.maxCiFixAttempts;
      // Prepend a fresh unchecked task (with the failure output inlined) to
      // the change's tasks.md, then re-spawn the worker. The loop's "first
      // unchecked section" rule then routes the worker straight at the fix.
      const runWorkerWithFixTask = async (
        heading: string,
        failureOutput: string,
      ): Promise<number> => {
        try {
          await prependFixTask(join(changeDir, "tasks.md"), heading, failureOutput);
        } catch (err) {
          log(`! could not prepend fix task: ${(err as Error).message}`, "red");
          return 1;
        }
        await reactivateState(stateFilePath, log, changeName);
        return respawnWorker();
      };

      // Single retry budget shared across commit + push hook failures. Both
      // flow through the same prepend-task → re-run-loop → retry-action
      // mechanism.
      let hookFixAttempt = 0;
      // Pre-commit retry: if the worker left uncommitted changes (typically
      // because the host's pre-commit hook rejected ralphy's
      // `docs(ralph): change finished` commit) we attempt the commit
      // ourselves and, on hook failure, feed the hook output back into the
      // loop as a new fix task.
      let commitGaveUp = false;
      while (true) {
        emit("committing", "git status");
        let dirty = "";
        try {
          const status = await cmd.run(["git", "status", "--porcelain"], cwd);
          dirty = status.stdout.trim();
        } catch (err) {
          log(`! git status failed for ${changeName}: ${(err as Error).message}`, "yellow");
          break;
        }
        if (!dirty) break;
        try {
          emit("committing", "git add -A");
          await cmd.run(["git", "add", "-A"], cwd);
          emit("committing", "git commit");
          await cmd.run(
            ["git", "commit", "-m", `chore(ralph): residual changes for ${changeName}`],
            cwd,
          );
          log(`  committed residual changes for ${changeName}`, "gray");
          break;
        } catch (err) {
          const e = err as Error & { stderr?: string; stdout?: string };
          const detail = e.stderr?.trim() || e.message;
          const combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
          // If there's nothing to commit (clean tree or lint-staged reformatted
          // files back to HEAD leaving an empty diff), accept and move on.
          if (/nothing to commit/i.test(combined) || /empty git commit/i.test(combined)) break;
          if (hookFixAttempt >= maxHookFixAttempts) {
            log(
              `! commit rejected for ${changeName} after ${hookFixAttempt} hook-fix attempts (host pre-commit hook still failing) — worktree preserved at ${cwd}`,
              "red",
            );
            log(`    detail: ${detail}`, "red");
            effectiveCode = PR_FAILED_EXIT;
            commitGaveUp = true;
            break;
          }
          hookFixAttempt += 1;
          emit("commit-retry", `${hookFixAttempt}/${maxHookFixAttempts}`);
          log(
            `! commit rejected for ${changeName} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxHookFixAttempts})`,
            "yellow",
          );
          log(`    detail: ${detail}`, "yellow");
          const retryCode = await runWorkerWithFixTask(
            "Fix host pre-commit hook rejection",
            `Committing residual changes was rejected by the host repo's pre-commit hook. ` +
              `Fix the underlying problem, then the commit will be retried.\n\n` +
              combined.trim(),
          );
          if (retryCode !== 0) {
            log(
              `! worker re-run after commit rejection exited code ${retryCode} — giving up`,
              "red",
            );
            effectiveCode = PR_FAILED_EXIT;
            commitGaveUp = true;
            break;
          }
        }
      }

      let pr: Awaited<ReturnType<typeof createPullRequest>> = null;
      let prGaveUp = commitGaveUp;
      let nonFfRebaseAttempted = false;
      // Retry loop: when a push is rejected (e.g. pre-push hook running lint/
      // typecheck, or any other push failure) we prepend a fix task with the
      // failure output and re-run the worker loop so the AI fixes the
      // underlying issue, then retry the PR. Shares the hookFixAttempt budget
      // with commit.
      while (!prGaveUp) {
        try {
          emit("pr-create", "git push + gh pr create");
          pr = await createPullRequest({ cwd, branch, issue, base: cfg.prBaseBranch }, cmd);
          break;
        } catch (err) {
          const e = err as Error & {
            stderr?: string;
            stdout?: string;
            code?: number;
          };
          const detail = e.stderr?.trim() || e.message;
          const combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
          // A non-fast-forward push means the remote branch advanced (e.g.
          // a previous push retry actually landed, or someone else pushed).
          // The fix is not "rerun Claude" — it's a rebase. Try once.
          const isNonFastForward =
            /non-fast-forward|Updates were rejected because the (tip of your current branch is behind|remote contains work)/i.test(
              combined,
            ) && !/pre-push hook|hook declined/i.test(combined);
          const isHookReject = /pre-push hook|hook declined/i.test(combined);
          const pushRejected = isHookReject || /failed to push some refs/i.test(combined);

          if (isNonFastForward && !nonFfRebaseAttempted) {
            nonFfRebaseAttempted = true;
            emit("rebasing", `git pull --rebase origin ${branch}`);
            log(
              `  non-fast-forward push for ${changeName} — rebasing onto origin/${branch}`,
              "yellow",
            );
            try {
              await cmd.run(["git", "fetch", "origin", branch], cwd);
              await cmd.run(["git", "pull", "--rebase", "origin", branch], cwd);
              continue;
            } catch (rebaseErr) {
              const re = rebaseErr as Error & { stderr?: string; stdout?: string };
              const reBlob = `${re.stdout ?? ""}\n${re.stderr ?? ""}`;
              const isConflict = /CONFLICT|Merge conflict|could not apply|both modified/i.test(
                reBlob,
              );
              if (!isConflict) {
                log(
                  `! rebase failed for ${changeName}: ${(rebaseErr as Error).message} — giving up`,
                  "red",
                );
                effectiveCode = PR_FAILED_EXIT;
                prGaveUp = true;
                break;
              }
              // Conflict: abort the in-progress rebase to leave a clean
              // working tree, gather the conflicted file list, and feed it
              // back to the worker as a fix task so the AI can resolve it.
              emit("rebasing", "conflicts detected — aborting + queueing fix task");
              try {
                await cmd.run(["git", "rebase", "--abort"], cwd);
              } catch {
                /* if --abort itself fails, the worktree may already be clean */
              }
              let conflictedFiles = "";
              try {
                const r = await cmd.run(
                  ["git", "diff", "--name-only", `HEAD..origin/${branch}`],
                  cwd,
                );
                conflictedFiles = r.stdout.trim();
              } catch {
                /* best-effort */
              }
              if (hookFixAttempt >= maxHookFixAttempts) {
                log(
                  `! merge conflict on rebase of ${branch} after ${hookFixAttempt} attempts — worktree preserved at ${cwd}`,
                  "red",
                );
                log(`    detail: ${reBlob.trim().split("\n").slice(0, 8).join("\n")}`, "red");
                effectiveCode = PR_FAILED_EXIT;
                prGaveUp = true;
                break;
              }
              hookFixAttempt += 1;
              emit("rebasing", `conflict-fix ${hookFixAttempt}/${maxHookFixAttempts}`);
              log(
                `! merge conflict rebasing ${branch} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxHookFixAttempts})`,
                "yellow",
              );
              const retryCode = await runWorkerWithFixTask(
                "Resolve merge conflict with origin/" + branch,
                `Push to origin/${branch} was rejected as non-fast-forward, and rebasing ` +
                  `onto origin/${branch} produced merge conflicts.\n\n` +
                  `Run \`git fetch origin ${branch}\` and \`git rebase origin/${branch}\`, ` +
                  `resolve every conflict, \`git add\` the resolved files, and finish with ` +
                  `\`git rebase --continue\`. The push will be retried after this loop ` +
                  `iteration finishes.\n\n` +
                  (conflictedFiles
                    ? `Files that differ between your branch and origin/${branch}:\n${conflictedFiles}\n\n`
                    : "") +
                  `Rebase output:\n${reBlob.trim()}`,
              );
              if (retryCode !== 0) {
                log(
                  `! worker re-run after merge conflict exited code ${retryCode} — giving up`,
                  "red",
                );
                effectiveCode = PR_FAILED_EXIT;
                prGaveUp = true;
                break;
              }
              // Allow another rebase attempt now that the worker has
              // (presumably) resolved the conflict and committed.
              nonFfRebaseAttempted = false;
              continue;
            }
          }

          if (!pushRejected || hookFixAttempt >= maxHookFixAttempts) {
            if (pushRejected) {
              log(
                `! push rejected for ${changeName} after ${hookFixAttempt} fix attempts (push still failing) — worktree preserved at ${cwd}`,
                "red",
              );
              log(`    detail: ${detail}`, "red");
            } else {
              log(`! PR create failed for ${changeName}: ${detail}`, "red");
            }
            effectiveCode = PR_FAILED_EXIT;
            prGaveUp = true;
            break;
          }
          hookFixAttempt += 1;
          emit("push-retry", `${hookFixAttempt}/${maxHookFixAttempts}`);
          log(
            `! push rejected for ${changeName} — prepending fix task and re-running loop (attempt ${hookFixAttempt}/${maxHookFixAttempts})`,
            "yellow",
          );
          log(`    detail: ${detail}`, "yellow");
          const retryCode = await runWorkerWithFixTask(
            "Fix push rejection",
            `Push to origin/${branch} was rejected. Fix the underlying problem ` +
              `(e.g. failing pre-push hook checks), then the push will be retried.\n\n` +
              combined.trim(),
          );
          if (retryCode !== 0) {
            log(`! worker re-run after push rejection exited code ${retryCode} — giving up`, "red");
            effectiveCode = PR_FAILED_EXIT;
            prGaveUp = true;
            break;
          }
        }
      }

      if (prGaveUp) {
        // already logged + effectiveCode set
      } else if (!pr) {
        log(`  no commits ahead of ${cfg.prBaseBranch} — skipping PR`, "gray");
      } else {
        log(`  ${pr.created ? "opened" : "found existing"} PR: ${pr.url}`, "green");
        deps.registerPr?.(changeName, pr.url);

        if (wantFixCi) {
          log(`  watching CI for ${pr.url} (max ${cfg.maxCiFixAttempts} fix attempts)`, "gray");
          emit("ci-poll", "starting");
          const result = await fixCiUntilGreen(
            {
              onPhase: (p, d) => emit(p as PostTaskPhase, d),
              getStatus: () =>
                getPrChecksStatus(pr.url, cmd, cwd, (n, ms, why) =>
                  log(
                    `  gh transient (try ${n}) — retry in ${Math.round(ms / 1000)}s · ${why}`,
                    "yellow",
                  ),
                ),
              getFailedLogs: (ids) => fetchFailedRunLogs(ids, cmd, cwd),
              runTaskWithSteering: async (steering) => {
                try {
                  await prependFixTask(
                    join(changeDir, "tasks.md"),
                    "Fix failing CI checks",
                    steering,
                  );
                } catch (err) {
                  log(`! could not prepend fix task: ${(err as Error).message}`, "red");
                }
                return respawnWorker();
              },
              pushBranch: async () => {
                await cmd.run(["git", "push", "origin", branch], cwd);
              },
              log,
              sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            },
            {
              maxAttempts: cfg.maxCiFixAttempts,
              pollIntervalSeconds: cfg.ciPollIntervalSeconds,
            },
          );
          if (!result.success) {
            log(
              `! CI fix loop gave up after ${result.attempts} attempts (${result.reason ?? "unknown"}) — withholding done-status until CI passes`,
              "red",
            );
            effectiveCode = CI_FAILED_EXIT;
          }
        }
      }
    }
  }

  if (effectiveCode === 0) emit("done");
  else emit("gave-up", `exit ${effectiveCode}`);

  if (useWorktree && cwd !== projectRoot) {
    emit("cleanup", "checking worktree safety");
    // Only clean up the worktree on full success — that includes CI passing
    // when fix-CI is on. Failed CI keeps the worktree and branch for human
    // inspection on the existing PR.
    if (effectiveCode === 0 && cfg.cleanupWorktreeOnSuccess) {
      // Strict pre-removal guard: never `git worktree remove --force` a
      // worktree that still has uncommitted files or commits not yet
      // pushed/PR'd — `--force` would destroy them silently.
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
      } else {
        try {
          await removeWorktree(projectRoot, cwd, git);
          log(`  removed worktree ${cwd}`, "gray");
        } catch (err) {
          log(`! worktree remove failed for ${changeName}: ${(err as Error).message}`, "yellow");
        }
      }
    }
  }

  return effectiveCode;
}
