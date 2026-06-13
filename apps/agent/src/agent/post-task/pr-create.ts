import type { TrackedIssue } from "@ralphy/tracker";
import { createPullRequest } from "../pr";
import { MAX_PR_CREATE_ATTEMPTS, type PostTaskCtx } from "./types";
import { runWorkerWithFixTask } from "./respawn";

/**
 * Push the branch and open (or surface) a GitHub PR, retrying on push
 * rejections (pre-push hooks, non-fast-forward) by feeding failure output
 * back to the worker as a fix task. Shares the `hookFixAttempt` budget with
 * the commit phase.
 *
 * Returns `{ pr, gaveUp }`. When `gaveUp` is true the caller should set
 * effectiveCode = PR_FAILED_EXIT; `pr` will be null in that case.
 */
export async function createPrWithRetry(
  ctx: PostTaskCtx,
  issue: TrackedIssue,
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
