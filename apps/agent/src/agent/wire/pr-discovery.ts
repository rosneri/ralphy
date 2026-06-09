import { PollContext } from "../../shared/capabilities/poll-context";
import { discoverPrUrlFromGitHub, createPrUrlCache } from "../pr-url";
import { getPrChecksStatus } from "../ci";
import { fetchIssueAttachments } from "../linear";
import type { TrackedIssue } from "@ralphy/tracker";
import { changeNameForIssue } from "../scaffold";
import type { CmdRunner } from "../pr";
import type { PrStatusBucket as PrStatus } from "../coordinator";
import { pickOpenPrUrlFromAttachments } from "./pr-helpers";
import { waitForMergeability } from "../../shared/pr/wait-for-mergeability";

const PR_UNAVAILABLE_TTL_MS = 10 * 60 * 1000;

interface PrDiscoveryInput {
  apiKey: string;
  projectRoot: string;
  cmdRunner: CmdRunner;
  onLog: (text: string, color?: string) => void;
  diag: (area: string, message: string, color?: string) => void;
  prByChange: Map<string, string>;
  /** Initial poll context; refreshed by setter on each beforePoll. */
  getPollContext: () => PollContext;
  /** CI check names the watcher ignores when judging a PR green — must match
   *  what the in-`gh pr checks` filter uses elsewhere (RLF-97: previously this
   *  watcher path dropped the configured ignore-list). */
  ignoreCiChecks: string[];
}

interface PrDiscovery {
  checkPrStatus: (issue: TrackedIssue) => Promise<{ url: string; status: PrStatus } | null>;
  resolvePrUrlForIssue: (issue: TrackedIssue) => Promise<string | null>;
  isPrUnavailable: (changeName: string) => boolean;
  markPrUnavailable: (changeName: string) => void;
  invalidatePrUrlForIssue: (issueId: string) => void;
  clearPrUnavailable: (changeName: string) => void;
}

export function createPrDiscovery(input: PrDiscoveryInput): PrDiscovery {
  const {
    apiKey,
    projectRoot,
    cmdRunner,
    onLog,
    diag,
    prByChange,
    getPollContext,
    ignoreCiChecks,
  } = input;
  const prUnavailable = new Map<string, number>();
  const prUrlByIssue = createPrUrlCache(5 * 60 * 1000);

  function isPrUnavailable(changeName: string): boolean {
    const expiry = prUnavailable.get(changeName);
    if (expiry === undefined) return false;
    if (Date.now() >= expiry) {
      prUnavailable.delete(changeName);
      return false;
    }
    return true;
  }
  function markPrUnavailable(changeName: string): void {
    prUnavailable.set(changeName, Date.now() + PR_UNAVAILABLE_TTL_MS);
  }

  async function discoverPrUrlFromLinear(
    issue: TrackedIssue,
  ): Promise<{ url: string | null; sawNonOpenPr: boolean }> {
    let attachments;
    try {
      attachments = await fetchIssueAttachments(apiKey, issue.id);
    } catch (err) {
      diag(
        "linear",
        `! Linear attachments fetch failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return { url: null, sawNonOpenPr: false };
    }
    return pickOpenPrUrlFromAttachments(
      attachments.map((a) => a.url),
      issue.identifier,
      cmdRunner,
      projectRoot,
      onLog,
    );
  }

  async function discoverPrUrl(issue: TrackedIssue, changeName: string): Promise<string | null> {
    const fromGitHub = await discoverPrUrlFromGitHub(
      issue.identifier,
      cmdRunner,
      projectRoot,
      onLog,
    );
    if (fromGitHub) return fromGitHub;

    const fromLinear = await discoverPrUrlFromLinear(issue);
    if (fromLinear.url) {
      diag(
        "pr",
        `  ${issue.identifier}: PR discovered via Linear attachment (${fromLinear.url})`,
        "gray",
      );
      return fromLinear.url;
    }

    if (fromLinear.sawNonOpenPr) {
      markPrUnavailable(changeName);
      return null;
    }

    // No PR found. Mark unavailable so subsequent polls in the next 10m
    // short-circuit, but stay silent — callers decide whether a missing PR
    // is worth a log line. The conflict-scan path (`checkPrStatus` below)
    // logs explicitly; the mention-scan path stays silent because Todo
    // tickets legitimately have no PR yet.
    markPrUnavailable(changeName);
    return null;
  }

  async function checkPrStatus(
    issue: TrackedIssue,
  ): Promise<{ url: string; status: PrStatus } | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;

    let prUrl: string | undefined = prByChange.get(changeName);
    if (!prUrl) {
      const found = await discoverPrUrl(issue, changeName);
      if (!found) {
        diag(
          "pr",
          `  ${issue.identifier}: no PR found via GitHub search or Linear attachments; conflict scan skipped for ${PR_UNAVAILABLE_TTL_MS / 60000}m`,
          "gray",
        );
        return null;
      }
      prUrl = found;
      prByChange.set(changeName, prUrl);
    }

    const outcome = await waitForMergeability({
      // Attempt 0 shares the per-poll memo with other scan paths; every retry
      // forces a fresh `gh pr view` so the backoff actually waits out GitHub's
      // async mergeability computation instead of re-reading a cached UNKNOWN.
      probe: async (attempt) =>
        (await getPollContext().fetchPrOnce(
          prUrl,
          ["state", "mergeable", "mergeStateStatus"],
          cmdRunner,
          projectRoot,
          { forceRefresh: attempt > 0 },
        )) as { state?: string; mergeable?: string; mergeStateStatus?: string },
      onError: (err, attempt, total) =>
        diag(
          "pr",
          `! gh pr view ${prUrl} failed (attempt ${attempt + 1}/${total}): ${err.message} — will retry`,
          "yellow",
        ),
    });
    if (outcome.kind === "closed") {
      markPrUnavailable(changeName);
      prUrlByIssue.invalidate(issue.id);
      return null;
    }
    if (outcome.kind === "unknown") {
      diag(
        "pr",
        `  ${issue.identifier}: mergeability still UNKNOWN after retries (${prUrl}) — will recheck next poll`,
        "gray",
      );
      return { url: prUrl, status: "unknown" };
    }
    if (outcome.kind === "conflicting") return { url: prUrl, status: "conflicted" };

    try {
      const ci = await getPrChecksStatus(prUrl, cmdRunner, projectRoot, undefined, ignoreCiChecks);
      if (ci.bucket === "fail") return { url: prUrl, status: "ci_failed" };
      // RLF-97: CI still in progress is NOT mergeable. Reporting "mergeable"
      // here clears the pr-tracker recovery counter on every poll between CI
      // re-runs (scanPrMergeStates clears on "mergeable"), so `maxRecoverySessions`
      // never trips for a PR that keeps flapping red. "unknown" is a scan no-op:
      // no clear, no queue — the counter survives until CI settles to pass or fail.
      if (ci.bucket === "pending") return { url: prUrl, status: "unknown" };
    } catch (err) {
      diag("ci", `! gh pr checks ${prUrl} failed (PR scan): ${(err as Error).message}`, "yellow");
    }

    // BAN-799: GitHub's `mergeable` field (and a settled `mergeStateStatus`) only
    // mean "no git conflict" — a PR can be git-mergeable yet still be a DRAFT or
    // awaiting required review approval (mergeStateStatus BLOCKED). Neither is
    // "done". Without this gate the watcher advanced such PRs to done and
    // disposed the flow actor, marking the issue complete while the PR was still
    // draft / unapproved / unmerged. Hold here (status "unknown" — a scan no-op,
    // same as pending CI) until the PR is genuinely ready. The extra `gh pr view`
    // runs only on the otherwise-mergeable path (rare) and is memoised per poll.
    // Undetermined fields default to ready: never block done on an inability to
    // read the PR, and repos with no required review return reviewDecision=null.
    try {
      const readiness = (await getPollContext().fetchPrOnce(
        prUrl,
        ["isDraft", "reviewDecision"],
        cmdRunner,
        projectRoot,
      )) as { isDraft?: boolean; reviewDecision?: string };
      const isDraft = readiness.isDraft === true;
      const reviewDecision = readiness.reviewDecision?.toUpperCase();
      const awaitingApproval =
        reviewDecision === "REVIEW_REQUIRED" || reviewDecision === "CHANGES_REQUESTED";
      if (isDraft || awaitingApproval) {
        diag(
          "pr",
          `  ${issue.identifier}: PR ${prUrl} is green + conflict-free but ${
            isDraft ? "still a draft" : "awaiting review approval"
          } — holding (not done) until it is ready`,
          "gray",
        );
        return { url: prUrl, status: "unknown" };
      }
    } catch (err) {
      diag(
        "pr",
        `! gh pr view ${prUrl} readiness check failed (PR scan): ${(err as Error).message} — treating as ready`,
        "yellow",
      );
    }
    return { url: prUrl, status: "mergeable" };
  }

  async function resolvePrUrlForIssue(issue: TrackedIssue): Promise<string | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;
    const inflight = prByChange.get(changeName);
    if (inflight) return inflight;

    const cached = prUrlByIssue.get(issue.id);
    if (cached !== undefined) return cached;

    const found = await discoverPrUrl(issue, changeName);
    prUrlByIssue.set(issue.id, found);
    if (found) prByChange.set(changeName, found);
    return found;
  }

  return {
    checkPrStatus,
    resolvePrUrlForIssue,
    isPrUnavailable,
    markPrUnavailable,
    invalidatePrUrlForIssue: (issueId: string) => prUrlByIssue.invalidate(issueId),
    clearPrUnavailable: (changeName: string) => prUnavailable.delete(changeName),
  };
}
