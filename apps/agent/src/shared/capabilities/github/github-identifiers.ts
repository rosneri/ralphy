/**
 * IO-free GitHub issue identifier helpers — the slugging / change-name / branch
 * derivation the `IdentifierStrategy` seam needs, with no `gh` subprocess
 * dependency. Splitting these out from the (now removed) transport layer keeps
 * `identifier-strategy.ts` from pulling in `CmdRunner` / `Bus` / the capability
 * shell just to compute a change-name.
 */

import { branchForChange } from "../../../agent/worktree";

/** Minimal issue shape the slugger / strategy needs. */
export interface GitHubIssueRef {
  number: number;
  title: string;
  owner?: string | null;
  repo?: string | null;
}

/** Slug rules identical to `changeNameForIssue` (lowercase, non-alnum→`-`,
 *  slice 40, trim dashes). */
function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
}

/** `gh-<number>-<title-slug>` (fallback `gh-<number>` when slug empty). */
function changeNameForGitHubIssue(issue: GitHubIssueRef): string {
  const slug = slugifyTitle(issue.title);
  return slug ? `gh-${issue.number}-${slug}` : `gh-${issue.number}`;
}

/** GitHub identifier strategy implementation — wraps the slugger functions
 *  above. Conformance to `IdentifierStrategy` is enforced (and the public
 *  `githubIdentifierStrategy` name assigned) where it is re-exported
 *  (`identifier-strategy.ts`); leaving it inferred here avoids a runtime
 *  import cycle. */
export const githubIdentifierStrategyImpl = {
  scopeKey: (issue: GitHubIssueRef): string =>
    issue.owner && issue.repo ? `${issue.owner}/${issue.repo}` : "",
  changeName: (issue: GitHubIssueRef): string => changeNameForGitHubIssue(issue),
  branchName: (issue: GitHubIssueRef): string => branchForChange(changeNameForGitHubIssue(issue)),
};
