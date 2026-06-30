import { findBoundaryViolations } from "@ralphy/workflow/boundaries";
import { baseBranchFromLabels } from "../../shared/capabilities/linear-client/filters";
import type { CodeHost } from "@ralphy/codehost";
import type { TrackedIssue } from "@ralphy/tracker";
import type { CmdRunner } from "../pr";
import { createPullRequest } from "../pr";
import type { DependencyBase } from "../wire/pr-helpers";
import {
  MAX_PR_CREATE_ATTEMPTS,
  NO_CHANGES_EXIT,
  PR_FAILED_EXIT,
  summarizeUncommittedStatus,
  type PostTaskCtx,
  type PostTaskInput,
  type PostTaskPhase,
} from "./types";
import { createPrWithRetry } from "./pr-create";
import { runWorkerWithFixTask } from "./respawn";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Inputs consumed only by the PR phase. */
interface PrPhaseInput {
  changeName: string;
  cwd: string;
  branch: string | null;
  changeDir: string;
  stateFilePath: string;
  issue: TrackedIssue | null;
  wantAutoMerge: boolean;
  config: PostTaskInput["cfg"];
}

/**
 * Pre-PR boundary check. Compares the change set (relative to the base
 * branch) against `boundaries.never_touch`. Returns the list of forbidden
 * files that the agent modified anyway, or an empty array when clean.
 */
async function findNeverTouchViolations(
  codeHost: CodeHost,
  cwd: string,
  base: string,
  neverTouch: string[],
): Promise<{ file: string; pattern: string }[]> {
  if (neverTouch.length === 0) return [];
  let files: string[] = [];
  try {
    files = await codeHost.changedFiles(`origin/${base}...HEAD`, cwd);
  } catch {
    // Fall back to local base ref when origin/<base> isn't fetched.
    try {
      files = await codeHost.changedFiles(`${base}...HEAD`, cwd);
    } catch {
      return [];
    }
  }
  return findBoundaryViolations(files, neverTouch);
}

/** Deps consumed only by the PR phase. */
interface PrPhaseDeps {
  cmd: CmdRunner;
  codeHost: CodeHost;
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
   *  only when `config.stackPrsOnDependencies` is true and no `ralph:branch:`
   *  label override is present. */
  resolveDependencyBaseBranch?: (issue: TrackedIssue) => Promise<DependencyBase | null>;
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
  const { changeName, cwd, branch, changeDir, stateFilePath, issue, wantAutoMerge, config } = input;
  const {
    cmd,
    codeHost,
    log,
    emit,
    respawnWorker,
    registerPr,
    onPrReady,
    resolveDependencyBaseBranch,
  } = deps;

  if (!branch || !issue) {
    log(
      `! createPr requested but no worktree branch is tracked for ${changeName} (use --worktree)`,
      "yellow",
    );
    return PR_FAILED_EXIT;
  }

  const labelBase = baseBranchFromLabels(issue.labels);
  let base = labelBase ?? config.prBaseBranch;
  let stackedOn: DependencyBase | undefined;
  if (labelBase && labelBase !== config.prBaseBranch) {
    log(`  base branch override from label: ${labelBase}`, "gray");
  } else if (config.stackPrsOnDependencies && resolveDependencyBaseBranch) {
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
    cfg: config,
    cmd,
    codeHost,
    log,
    emit,
    respawnWorker,
  };

  try {
    const statusOut = await codeHost.workingTreeStatus(cwd);
    const summary = summarizeUncommittedStatus(statusOut);
    if (summary.count > 0) {
      const existingPrUrl = branch ? await codeHost.findOpenPullRequestForBranch(branch) : null;
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

  const violations = await findNeverTouchViolations(codeHost, cwd, base, config.neverTouch);
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
  const finalizeNoOpAsDone = config.finalizeNoOpAsDone !== false;
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
      const statusOut = await codeHost.workingTreeStatus(cwd);
      dirtyAfterWorker = summarizeUncommittedStatus(statusOut).count > 0;
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
  if (config.prDraft === true) {
    emit("pr-ready");
    try {
      await codeHost.markReady(prUrl);
      log(`  converted ${prUrl} from draft to ready`, "green");
    } catch (err) {
      const e = err as Error & { stderr?: string };
      log(`! gh pr ready failed for ${prUrl}: ${e.stderr?.trim() || e.message}`, "yellow");
      readyOk = false;
    }
  }

  // A draft that could not be converted to ready can't be auto-merged — skip it.
  if (wantAutoMerge && readyOk) {
    const repositoryAllowsAutoMerge = await codeHost.isAutoMergeAllowed(prUrl);
    if (repositoryAllowsAutoMerge === false) {
      // RLF-97: the worker no longer polls CI in-process, so it can't merge a
      // repo with auto-merge disabled "once checks pass". Leave the PR open for
      // a human / repo settings to merge instead of merging speculatively now.
      log(
        config.manualMergeWhenAutoMergeDisabled !== false
          ? `  repo has auto-merge disabled — leaving ${prUrl} open for manual merge once checks pass`
          : `  repo has auto-merge disabled (manual-merge fallback off) — ${prUrl} will not auto-merge`,
        "yellow",
      );
    } else {
      try {
        await codeHost.enableAutoMerge(prUrl, config.autoMergeStrategy);
        log(`  enabled auto-merge (${config.autoMergeStrategy}) on ${prUrl}`, "green");
        emit("auto-merge-enabled", config.autoMergeStrategy);
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
