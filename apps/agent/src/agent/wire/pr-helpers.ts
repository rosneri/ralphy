import {
  fetchAttachmentsForIssues,
  fetchBlockedByForIssues,
  baseBranchFromLabels,
  type LinearIssue,
} from "../linear";
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

/** A blocker's open PR, tagged with the blocker issue id that owns it. */
interface BlockerCandidate {
  blockerId: string;
  base: DependencyBase;
}

/**
 * From a set of blockers that each have an open PR, pick the dependency *tip* —
 * the single most-downstream blocker, i.e. the one that is (directly or
 * transitively) blocked by all the others. In a chain `A ← B ← C`, an issue
 * blocked by both `A` and `B` should stack onto `B` (which already contains
 * `A`), not bail to `main`.
 *
 * The tip is the unique candidate whose id appears in *no other* candidate's
 * `blocked_by` set (nothing else in the set depends on it being last). Returns
 * null when there is no unique tip (genuinely independent blockers) so the
 * caller falls back to the default base.
 */
function pickDependencyTip(
  candidates: BlockerCandidate[],
  blockedByOfCandidate: Map<string, Set<string>>,
): BlockerCandidate | null {
  const candidateIds = new Set(candidates.map((c) => c.blockerId));
  // A candidate is "upstream" if some *other* candidate is blocked by it.
  const upstream = new Set<string>();
  for (const c of candidates) {
    const blockers = blockedByOfCandidate.get(c.blockerId) ?? new Set<string>();
    for (const otherId of blockers) {
      if (otherId !== c.blockerId && candidateIds.has(otherId)) upstream.add(otherId);
    }
  }
  const tips = candidates.filter((c) => !upstream.has(c.blockerId));
  return tips.length === 1 ? (tips[0] as BlockerCandidate) : null;
}

/**
 * Standalone variant of the dependency-base resolver — exported so unit tests
 * can exercise it without booting the full coordinator. The closure inside
 * `buildAgentCoordinator` delegates to this.
 *
 * Re-resolves the issue's blockers *live* from Linear at call time (rather than
 * trusting the snapshot captured when the worker spawned, which is often empty
 * because the `blocked_by` link is added after work starts). Returns the blocker
 * PR's identity (branch + ticket + PR) when a single open-PR blocker is found,
 * or — when several blockers have open PRs — the unique dependency *tip*. Null
 * otherwise (no blockers, no open blocker PR, genuinely independent blockers, or
 * lookup failure) so the caller falls back to the default base branch.
 */
export async function resolveDependencyBaseBranchImpl(
  issue: LinearIssue,
  runner: CmdRunner,
  runnerCwd: string,
  deps: { apiKey: string; onLog: (msg: string, color?: string) => void },
): Promise<DependencyBase | null> {
  // Re-resolve blockers fresh; fall back to the spawn snapshot if Linear fails.
  let blockerIds: string[];
  try {
    const live = await fetchBlockedByForIssues(deps.apiKey, [issue.id]);
    blockerIds = (live.get(issue.id) ?? []).map((b) => b.id);
  } catch (err) {
    deps.onLog(
      `! could not refresh blockers for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    blockerIds = issue.blockedByIds;
  }
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

  const candidates: BlockerCandidate[] = [];
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
      candidates.push({ blockerId, base: openPrs[0] as DependencyBase });
    } else if (openPrs.length > 1) {
      deps.onLog(
        `  ${issue.identifier}: blocker ${blockerId} has ${openPrs.length} open PRs — skipping dependency base resolution`,
        "gray",
      );
    }
  }

  if (candidates.length === 1) return (candidates[0] as BlockerCandidate).base;
  if (candidates.length === 0) return null;

  // Several blockers have open PRs (a dependency chain). Stack onto the tip
  // instead of bailing — but that needs each candidate's own blockers, so
  // fetch them and resolve the most-downstream one.
  let blockedByOfCandidate: Map<string, Set<string>>;
  try {
    const map = await fetchBlockedByForIssues(
      deps.apiKey,
      candidates.map((c) => c.blockerId),
    );
    blockedByOfCandidate = new Map(
      [...map.entries()].map(([id, refs]) => [id, new Set(refs.map((r) => r.id))]),
    );
  } catch (err) {
    deps.onLog(
      `! could not resolve dependency order for ${issue.identifier}: ${(err as Error).message}`,
      "yellow",
    );
    return null;
  }

  const tip = pickDependencyTip(candidates, blockedByOfCandidate);
  if (!tip) {
    deps.onLog(
      `  ${issue.identifier}: ${candidates.length} blockers have open PRs with no single dependency tip — falling back to default base`,
      "gray",
    );
    return null;
  }
  deps.onLog(
    `  ${issue.identifier}: ${candidates.length} blockers have open PRs — stacking onto tip ${tip.base.blockerIdentifier ?? tip.blockerId}`,
    "gray",
  );
  return tip.base;
}

/** Collaborators for {@link createOpenDraftPr}. Plain values + maps so the
 *  factory is unit-testable with a mocked command runner. */
interface OpenDraftPrDeps {
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
