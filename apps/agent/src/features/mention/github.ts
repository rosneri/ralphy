import type { CmdRunner } from "../../agent/pr";
import { formatLinearError } from "../../agent/linear";
import { githubReactionSlug } from "../../agent/wire/task-bodies";

/** A GitHub issue/PR conversation comment as the mention scan consumes it. The
 *  numeric `id` is the REST comment id required by the reactions endpoint. */
export interface GithubIssueComment {
  id: number;
  body: string;
  createdAt: string;
  author?: string;
  url: string;
}

/** Post a reaction to a GitHub comment via `gh api`. */
export async function addGithubReactionToComment(
  cmdRunner: CmdRunner,
  projectRoot: string,
  source: { owner: string; repo: string; kind: "issue" | "review" },
  commentId: number,
  emoji: string,
): Promise<void> {
  const content = githubReactionSlug(emoji);
  const path =
    source.kind === "issue"
      ? `repos/${source.owner}/${source.repo}/issues/comments/${commentId}/reactions`
      : `repos/${source.owner}/${source.repo}/pulls/comments/${commentId}/reactions`;
  await cmdRunner.run(["gh", "api", "-X", "POST", path, "-f", `content=${content}`], projectRoot);
}

/** Fetch the issue-comments (conversation tab) for `owner/repo#number` via the
 *  REST issue-comments endpoint. Issues and PRs share this endpoint, so it
 *  serves both the GitHub-tracker issue scan and the PR-comment scan. Fails
 *  soft (logs yellow, returns `[]`) so one bad issue never aborts a scan. */
export async function fetchGithubIssueComments(
  cmdRunner: CmdRunner,
  projectRoot: string,
  repo: string,
  issueNumber: number,
  onLog: (msg: string, color?: string) => void,
): Promise<GithubIssueComment[]> {
  try {
    const res = await cmdRunner.run(
      [
        "gh",
        "api",
        `repos/${repo}/issues/${issueNumber}/comments`,
        "--jq",
        "[.[] | {id: .id, body: .body, createdAt: .created_at, author: .user.login, url: .html_url}]",
      ],
      projectRoot,
    );
    return JSON.parse(res.stdout || "[]") as GithubIssueComment[];
  } catch (err) {
    onLog(
      `! mention scan: gh comments failed for ${repo}#${issueNumber}: ${formatLinearError(err)}`,
      "yellow",
    );
    return [];
  }
}

/** Post a comment on a GitHub issue (or a PR's conversation tab) via REST. */
export async function postGithubIssueComment(
  cmdRunner: CmdRunner,
  projectRoot: string,
  repo: string,
  issueNumber: number,
  body: string,
  onLog: (msg: string, color?: string) => void,
): Promise<void> {
  try {
    await cmdRunner.run(
      [
        "gh",
        "api",
        "-X",
        "POST",
        `repos/${repo}/issues/${issueNumber}/comments`,
        "-f",
        `body=${body}`,
      ],
      projectRoot,
    );
  } catch (err) {
    onLog(
      `! mention scan: gh ack comment failed for ${repo}#${issueNumber}: ${formatLinearError(err)}`,
      "yellow",
    );
  }
}

/** Post a comment on a GitHub PR conversation tab. */
export async function postGithubPrComment(
  cmdRunner: CmdRunner,
  projectRoot: string,
  prUrl: string,
  body: string,
  onLog: (msg: string, color?: string) => void,
): Promise<void> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return;
  const [, owner, repo, num] = m;
  await postGithubIssueComment(
    cmdRunner,
    projectRoot,
    `${owner}/${repo}`,
    Number(num),
    body,
    onLog,
  );
}

/** Fetch issue-level comments on a PR (i.e. the conversation tab). */
export async function fetchPrIssueComments(
  cmdRunner: CmdRunner,
  projectRoot: string,
  prUrl: string,
  onLog: (msg: string, color?: string) => void,
): Promise<GithubIssueComment[]> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return [];
  const [, owner, repo, num] = m;
  return fetchGithubIssueComments(cmdRunner, projectRoot, `${owner}/${repo}`, Number(num), onLog);
}
