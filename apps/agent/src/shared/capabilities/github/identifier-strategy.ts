/**
 * Provider-hook seam for identifier handling. Today the agent hard-codes
 * Linear's `TEAM-NNN` identifier shape (`teamKeyOf`, `changeNameForIssue`);
 * this seam factors that out behind an `IdentifierStrategy` so a GitHub issue
 * (`#123` / `owner/repo#123`) can produce a change-name / branch / scope key
 * without those call sites assuming a `<team>-<number>` identifier.
 *
 * `linearIdentifierStrategy` reproduces today's exact behavior — the existing
 * Linear tests are the guard. `githubIdentifierStrategy` is defined in
 * `github-client.ts` (to avoid a runtime import cycle) and re-exported here;
 * the local annotation enforces its conformance to `IdentifierStrategy`.
 */

import type { LinearIssue } from "../linear-client";
import { branchForChange } from "../../../agent/worktree";
import { githubIdentifierStrategyImpl, type GitHubIssueRef } from "./github-client";

interface IdentifierStrategy<I> {
  /** Cache/scope key — Linear: team key; GitHub: `owner/repo` or "". */
  scopeKey(issue: I): string;
  /** OpenSpec change-name slug for the issue. */
  changeName(issue: I): string;
  /** Branch name for the issue. */
  branchName(issue: I): string;
}

/** Linear change-name slug — must stay byte-identical to the legacy
 *  `scaffold.ts:changeNameForIssue`. */
function linearChangeName(issue: LinearIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return slug ? `${issue.identifier.toLowerCase()}-${slug}` : issue.identifier.toLowerCase();
}

export const linearIdentifierStrategy: IdentifierStrategy<LinearIssue> = {
  scopeKey: (issue) => issue.identifier.split("-")[0]!,
  changeName: linearChangeName,
  branchName: (issue) => branchForChange(linearChangeName(issue)),
};

export const githubIdentifierStrategy: IdentifierStrategy<GitHubIssueRef> =
  githubIdentifierStrategyImpl;
