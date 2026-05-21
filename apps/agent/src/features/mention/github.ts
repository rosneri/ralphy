import type { CmdRunner } from "../../agent/pr";
import { formatLinearError } from "../../agent/linear";
import { githubReactionSlug } from "../../agent/wire/task-bodies";

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

/** Fetch issue-level comments on a PR (i.e. the conversation tab). */
export async function fetchPrIssueComments(
  cmdRunner: CmdRunner,
  projectRoot: string,
  prUrl: string,
  onLog: (msg: string, color?: string) => void,
): Promise<{ id: number; body: string; createdAt: string; author?: string; url: string }[]> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return [];
  const [, owner, repo, num] = m;
  try {
    const res = await cmdRunner.run(
      [
        "gh",
        "api",
        `repos/${owner}/${repo}/issues/${num}/comments`,
        "--jq",
        "[.[] | {id: .id, body: .body, createdAt: .created_at, author: .user.login, url: .html_url}]",
      ],
      projectRoot,
    );
    const parsed = JSON.parse(res.stdout || "[]") as {
      id: number;
      body: string;
      createdAt: string;
      author?: string;
      url: string;
    }[];
    return parsed;
  } catch (err) {
    onLog(`! mention scan: gh comments failed for ${prUrl}: ${formatLinearError(err)}`, "yellow");
    return [];
  }
}
