import { fetchAttachmentsForIssues, baseBranchFromLabels, type LinearIssue } from "../linear";
import { createPullRequest, type CmdRunner } from "../pr";

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
 * Identity of the blocker PR a stacked PR is based on. Carries enough to make
 * the dependency clear in logs and on the PR itself — the head branch used as
 * the new PR's base, the blocker PR URL/number, and the blocker ticket
 * identifier (best-effort).
 */
export interface DependencyBase {
  /** Head branch of the blocker's single open PR; used as the new PR's base. */
  baseBranch: string;
  /** URL of the blocker PR the new PR is stacked on top of. */
  prUrl: string;
  /** PR number parsed from `prUrl`, or null when it could not be parsed. */
  prNumber: number | null;
  /** Blocker ticket identifier (e.g. "LIT-42"), best-effort from the PR title. */
  blockerIdentifier: string | null;
}

const PR_NUMBER_RE = /\/pull\/(\d+)/;
/** Ralph titles its PRs `<IDENT>: <title>`, so the ticket leads the title. */
const TICKET_IN_TITLE_RE = /^([A-Za-z][A-Za-z0-9]*-\d+)\b/;

function parsePrNumber(url: string): number | null {
  const m = PR_NUMBER_RE.exec(url);
  return m ? Number(m[1]) : null;
}

/**
 * Standalone variant of the dependency-base resolver — exported so unit tests
 * can exercise it without booting the full coordinator. The closure inside
 * `buildAgentCoordinator` delegates to this. Keep behavior identical.
 *
 * Returns the blocker PR's identity (branch + ticket + PR) when exactly one
 * blocker has a single open PR; null otherwise (no blockers, ambiguous, or
 * lookup failure) so the caller falls back to the default base branch.
 */
export async function resolveDependencyBaseBranchImpl(
  issue: LinearIssue,
  runner: CmdRunner,
  runnerCwd: string,
  deps: { apiKey: string; onLog: (msg: string, color?: string) => void },
): Promise<DependencyBase | null> {
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

  const candidates: DependencyBase[] = [];
  for (const blockerId of blockerIds) {
    const attachments = attachmentsByBlocker.get(blockerId) ?? [];
    const prUrls = attachments
      .map((a) => a.url)
      .filter((url) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url));
    const openPrs: DependencyBase[] = [];
    for (const url of prUrls) {
      try {
        const res = await runner.run(
          ["gh", "pr", "view", url, "--json", "state,headRefName,title,url", "--jq", "."],
          runnerCwd,
        );
        const parsed = JSON.parse(res.stdout.trim()) as {
          state?: string;
          headRefName?: string;
          title?: string;
          url?: string;
        };
        if (parsed.state === "OPEN" && parsed.headRefName) {
          const prUrl = parsed.url ?? url;
          const titleMatch = parsed.title ? TICKET_IN_TITLE_RE.exec(parsed.title) : null;
          openPrs.push({
            baseBranch: parsed.headRefName,
            prUrl,
            prNumber: parsePrNumber(prUrl),
            blockerIdentifier: titleMatch ? (titleMatch[1] as string) : null,
          });
        }
      } catch (err) {
        deps.onLog(
          `! gh pr view failed for ${url} (blocker of ${issue.identifier}): ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    if (openPrs.length === 1) {
      candidates.push(openPrs[0] as DependencyBase);
    } else if (openPrs.length > 1) {
      deps.onLog(
        `  ${issue.identifier}: blocker ${blockerId} has ${openPrs.length} open PRs — skipping dependency base resolution`,
        "gray",
      );
    }
  }

  if (candidates.length === 1) return candidates[0] as DependencyBase;
  if (candidates.length > 1) {
    deps.onLog(
      `  ${issue.identifier}: ${candidates.length} blockers have open PRs — falling back to default base`,
      "gray",
    );
  }
  return null;
}

/** Collaborators for {@link createOpenDraftPr}. Plain values + maps so the
 *  factory is unit-testable with a mocked command runner. */
export interface OpenDraftPrDeps {
  /** changeName → worktree branch. A draft PR needs a tracked branch. */
  branchByChange: Map<string, string>;
  /** changeName → PR URL cache; the opened PR is registered here so the
   *  conflict/merge scans and post-task pick it up. */
  prByChange: Map<string, string>;
  cmdRunner: CmdRunner;
  /** Default base branch (overridden per-issue by a `ralph:branch:<name>` label). */
  prBaseBranch: string;
  /** Drop the per-issue PR-URL discovery cache so it re-resolves to the new PR. */
  invalidatePrUrlForIssue: (issueId: string) => void;
  /** Injectable for tests; defaults to the real {@link createPullRequest}. */
  createPr?: typeof createPullRequest;
}

/**
 * Build the `openDraftPr` callback handed to the confirmation feature. Opens
 * (or surfaces) a **draft** PR for the change's design at the gate-park point.
 *
 * Notes:
 * - Returns `null` when no branch is tracked (e.g. non-worktree runs) — the
 *   caller falls back to opening the PR at the end of the run.
 * - `metaOnlyFiles` is intentionally **omitted**: at design time the PR carries
 *   only the (meta) design files, so the meta-only guard must not block it.
 * - Reuses the idempotent `createPullRequest`, so a second call (or the
 *   end-of-run post-task phase) surfaces the existing PR instead of duplicating.
 */
export function createOpenDraftPr(
  deps: OpenDraftPrDeps,
): (issue: LinearIssue, changeName: string, cwd: string) => Promise<string | null> {
  const create = deps.createPr ?? createPullRequest;
  return async (issue, changeName, cwd) => {
    const branch = deps.branchByChange.get(changeName);
    if (!branch) return null;
    const base = baseBranchFromLabels(issue.labels) ?? deps.prBaseBranch;
    const result = await create({ cwd, branch, issue, base, draft: true }, deps.cmdRunner);
    const url = result?.url ?? null;
    if (url) {
      deps.prByChange.set(changeName, url);
      deps.invalidatePrUrlForIssue(issue.id);
    }
    return url;
  };
}
