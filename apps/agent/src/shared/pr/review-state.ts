import type { CmdRunner } from "../../agent/pr";

/** Query the PR for unresolved review thread count. */
export async function fetchPrReviewSummary(
  prUrl: string,
  runner: CmdRunner,
  cwd: string,
): Promise<{ unresolved: number } | null> {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(prUrl);
  if (!m) return null;
  const [, owner, repo, num] = m;
  const query = `query($owner:String!,$repo:String!,$num:Int!){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$num){
        reviewThreads(first:100){nodes{isResolved}}
      }
    }
  }`;
  try {
    const res = await runner.run(
      [
        "gh",
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repo=${repo}`,
        "-F",
        `num=${num}`,
      ],
      cwd,
    );
    const parsed = JSON.parse(res.stdout) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: { nodes: { isResolved: boolean }[] };
          } | null;
        } | null;
      };
    };
    const threads = parsed.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const unresolved = threads.filter((t) => !t.isResolved).length;
    return { unresolved };
  } catch {
    return null;
  }
}
