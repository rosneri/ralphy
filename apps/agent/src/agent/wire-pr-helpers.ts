import { fetchAttachmentsForIssues, type LinearIssue } from "./linear";
import type { CmdRunner } from "./pr";

const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

/**
 * Given a list of attachment URLs, return the first one that:
 *   - looks like a GitHub PR URL, and
 *   - `gh pr view --json state` reports as `OPEN`.
 *
 * Merged/closed PRs are skipped so the conflict scan does not
 * "discover" — and noisily log — PRs that have already landed.
 * Per-URL `gh` failures are logged yellow and the loop continues
 * to the next candidate.
 *
 * The `sawNonOpenPr` flag distinguishes "no PR at all" from "a PR exists
 * but it is MERGED/CLOSED", so callers can suppress the
 * "no open PR found" warning when the PR has already landed.
 */
export async function pickOpenPrUrlFromAttachments(
  urls: string[],
  issueIdent: string,
  cmd: CmdRunner,
  cwd: string,
  onLog: (msg: string, color?: string) => void,
): Promise<{ url: string | null; sawNonOpenPr: boolean }> {
  const candidates = urls.filter((url) => GITHUB_PR_URL_RE.test(url));
  let sawNonOpenPr = false;
  for (const url of candidates) {
    try {
      const res = await cmd.run(["gh", "pr", "view", url, "--json", "state"], cwd);
      const parsed = JSON.parse(res.stdout.trim()) as { state?: string };
      if (parsed.state === "OPEN") return { url, sawNonOpenPr };
      if (parsed.state === "MERGED" || parsed.state === "CLOSED") sawNonOpenPr = true;
    } catch (err) {
      onLog(`! gh pr view ${url} failed for ${issueIdent}: ${(err as Error).message}`, "yellow");
    }
  }
  return { url: null, sawNonOpenPr };
}

/**
 * Standalone variant of the dependency-base resolver — exported so unit tests
 * can exercise it without booting the full coordinator. The closure inside
 * `buildAgentCoordinator` delegates to this. Keep behavior identical.
 */
export async function resolveDependencyBaseBranchImpl(
  issue: LinearIssue,
  runner: CmdRunner,
  runnerCwd: string,
  deps: { apiKey: string; onLog: (msg: string, color?: string) => void },
): Promise<string | null> {
  const blockerIds = issue.blockedByIds;
  if (blockerIds.length === 0) return null;

  let attachmentsByBlocker: Awaited<ReturnType<typeof fetchAttachmentsForIssues>>;
  try {
    attachmentsByBlocker = await fetchAttachmentsForIssues(deps.apiKey, blockerIds);
  } catch (err) {
    deps.onLog(
      `! could not fetch attachments for blockers of ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return null;
  }

  const candidates: string[] = [];
  for (const blockerId of blockerIds) {
    const attachments = attachmentsByBlocker.get(blockerId) ?? [];
    const prUrls = attachments
      .map((a) => a.url)
      .filter((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url));
    const openHeads: string[] = [];
    for (const url of prUrls) {
      try {
        const res = await runner.run(
          ["gh", "pr", "view", url, "--json", "state,headRefName", "--jq", "."],
          runnerCwd,
        );
        const parsed = JSON.parse(res.stdout.trim()) as {
          state?: string;
          headRefName?: string;
        };
        if (parsed.state === "OPEN" && parsed.headRefName) {
          openHeads.push(parsed.headRefName);
        }
      } catch (err) {
        deps.onLog(
          `! gh pr view failed for ${url} (blocker of ${issue.identifier}): ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    if (openHeads.length === 1) {
      candidates.push(openHeads[0] as string);
    } else if (openHeads.length > 1) {
      deps.onLog(
        `  ${issue.identifier}: blocker ${blockerId} has ${openHeads.length} open PRs — skipping dependency base resolution`,
        "gray",
      );
    }
  }

  if (candidates.length === 1) return candidates[0] as string;
  if (candidates.length > 1) {
    deps.onLog(
      `  ${issue.identifier}: ${candidates.length} blockers have open PRs — falling back to default base`,
      "gray",
    );
  }
  return null;
}
