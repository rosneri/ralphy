import { PollContext } from "../../shared/capabilities/poll-context";
import { discoverPrUrlFromGitHub, createPrUrlCache } from "../pr-url";
import { getPrChecksStatus } from "../ci";
import { fetchIssueAttachments, type LinearIssue } from "../linear";
import { changeNameForIssue } from "../scaffold";
import type { CmdRunner } from "../pr";
import type { PrStatusBucket as PrStatus } from "../coordinator";
import { pickOpenPrUrlFromAttachments } from "./pr-helpers";

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
}

interface PrDiscovery {
  checkPrStatus: (issue: LinearIssue) => Promise<{ url: string; status: PrStatus } | null>;
  resolvePrUrlForIssue: (issue: LinearIssue) => Promise<string | null>;
  isPrUnavailable: (changeName: string) => boolean;
  markPrUnavailable: (changeName: string) => void;
  invalidatePrUrlForIssue: (issueId: string) => void;
  clearPrUnavailable: (changeName: string) => void;
}

export function createPrDiscovery(input: PrDiscoveryInput): PrDiscovery {
  const { apiKey, projectRoot, cmdRunner, onLog, diag, prByChange, getPollContext } = input;
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
    issue: LinearIssue,
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

  async function discoverPrUrl(issue: LinearIssue, changeName: string): Promise<string | null> {
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

    diag(
      "pr",
      `  ${issue.identifier}: no PR found via GitHub search or Linear attachments; conflict scan skipped for ${PR_UNAVAILABLE_TTL_MS / 60000}m`,
      "gray",
    );
    markPrUnavailable(changeName);
    return null;
  }

  async function checkPrStatus(
    issue: LinearIssue,
  ): Promise<{ url: string; status: PrStatus } | null> {
    const changeName = changeNameForIssue(issue);
    if (isPrUnavailable(changeName)) return null;

    let prUrl: string | undefined = prByChange.get(changeName);
    if (!prUrl) {
      const found = await discoverPrUrl(issue, changeName);
      if (!found) return null;
      prUrl = found;
      prByChange.set(changeName, prUrl);
    }

    let mergeable: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      let state: string | undefined;
      let m: string | undefined;
      try {
        const parsed = (await getPollContext().fetchPrOnce(
          prUrl,
          ["state", "mergeable"],
          cmdRunner,
          projectRoot,
        )) as { state?: string; mergeable?: string };
        state = parsed.state;
        m = parsed.mergeable;
      } catch (err) {
        diag(
          "pr",
          `! gh pr view ${prUrl} failed (attempt ${attempt + 1}/3): ${(err as Error).message} — will retry`,
          "yellow",
        );
        // m stays undefined → loop sleeps and retries rather than bailing immediately
      }
      if (state && state !== "OPEN") {
        markPrUnavailable(changeName);
        prUrlByIssue.invalidate(issue.id);
        return null;
      }
      if (m && m !== "UNKNOWN") {
        mergeable = m;
        break;
      }
      await new Promise<void>((r) => setTimeout(r, 2000));
    }
    if (mergeable === null) {
      diag(
        "pr",
        `  ${issue.identifier}: mergeability still UNKNOWN after retries (${prUrl}) — will recheck next poll`,
        "gray",
      );
      return { url: prUrl, status: "unknown" };
    }
    if (mergeable === "CONFLICTING") return { url: prUrl, status: "conflicted" };

    try {
      const ci = await getPrChecksStatus(prUrl, cmdRunner, projectRoot);
      if (ci.bucket === "fail") return { url: prUrl, status: "ci_failed" };
    } catch (err) {
      diag("ci", `! gh pr checks ${prUrl} failed (PR scan): ${(err as Error).message}`, "yellow");
    }
    return { url: prUrl, status: "mergeable" };
  }

  async function resolvePrUrlForIssue(issue: LinearIssue): Promise<string | null> {
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
