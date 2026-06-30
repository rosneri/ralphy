/**
 * Pure builders for the conflict-fix and ci-fix task bodies prepended to a
 * change's `tasks.md` when a PR has merge conflicts or failing CI. Extracted
 * from `prepare.ts` so the (long, behavior-defining) instruction text lives in
 * its own module and stays unit-testable in isolation. No logic changes — these
 * reproduce the original inline arrays verbatim.
 */

/**
 * Body for the "Resolve PR merge conflicts" task. Mirrors the original inline
 * block: a merge-not-rebase recovery runbook keyed on the base branch and the
 * branch ref, with an optional trailing PR link.
 */
export function buildConflictFixTaskBody(
  baseBranch: string,
  branchRef: string,
  prUrl: string | undefined,
): string {
  return [
    `The PR for this change has merge conflicts with \`${baseBranch}\`.`,
    "",
    "Steps:",
    `1. \`git fetch origin ${baseBranch}\` then merge \`${baseBranch}\` into the current branch (\`git merge origin/${baseBranch}\`). Do NOT rebase.`,
    "2. Resolve conflicts in the files git lists.",
    "3. Stage and commit the resolution as a new merge commit. Do NOT amend existing commits.",
    `4. Push the resolved branch with \`git push origin ${branchRef}\`. Never force-push.`,
    `   The post-task harness will NOT push for you in conflict-fix mode — you own the push.`,
    `   If the push is rejected, inspect the rejection output and react inline before retrying:`,
    `     - **non-fast-forward** (someone else pushed to \`${branchRef}\`):`,
    `       \`git fetch origin ${branchRef}\` then \`git merge origin/${branchRef}\` to bring their`,
    `       changes in as a new merge commit, re-resolve any new conflicts, and retry the push.`,
    `       Do NOT rebase and do NOT \`--force\` / \`--force-with-lease\` — work on the remote must`,
    `       never be overwritten.`,
    `     - **pre-push hook failure** (lint, typecheck, tests): fix the underlying problem locally,`,
    `       \`git add\` + \`git commit\` as a new commit (NEVER \`--amend\` an existing commit),`,
    `       then retry the push.`,
    `     - **ref-update policy rejection** (branch protection, required reviews): log the rejection`,
    `       message and stop — this requires human intervention; do not force past it.`,
    `   Only stop after exhausting the in-context fix. The push must succeed before this iteration ends.`,
    prUrl ? `\nPR: ${prUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Body for the "Fix failing CI checks" task. Mirrors the original inline block:
 * a gh-driven inspect/fix/push/re-run loop keyed on the branch ref, with an
 * optional trailing PR link.
 */
export function buildCiFixTaskBody(branchRef: string, prUrl: string | undefined): string {
  return [
    `The PR for this change has failing CI checks.`,
    "",
    "Steps:",
    `1. Inspect the failing checks: \`gh pr checks ${prUrl ?? "<pr-url>"}\` then`,
    `   \`gh run view <run-id> --log-failed\` for each red run.`,
    `2. Fix the underlying failures in the worktree (tests, lint, typecheck, build).`,
    `3. Stage and commit the fixes.`,
    `4. Push with \`git push origin ${branchRef}\`. If the push is rejected as`,
    `   non-fast-forward, \`git fetch origin ${branchRef}\` then \`git merge origin/${branchRef}\``,
    `   before retrying. Do NOT rebase, do NOT amend, and never force-push.`,
    `5. Wait for CI to re-run; if checks are still red, repeat from step 1.`,
    `   Stop only when CI is green or when the failure is clearly outside the change's scope`,
    `   (flaky infra, external service down) — in that case, log the rejection and exit.`,
    prUrl ? `\nPR: ${prUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
