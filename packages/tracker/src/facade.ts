import { buildRalphyMarker, parseRalphyMarker, type RalphyCommentType } from "@ralphy/comms";
import type { TrackedIssue } from "./issue";
import type { IssueTrackerProvider } from "./provider";
import type { IssueAttachments, IssueTracker, PollSnapshot } from "./tracker";

/**
 * Guarantee a body carries the hidden Ralphy marker of `type`, so a sticky
 * upsert can always re-discover its own comment. A body already carrying a
 * typed marker (of any type — callers compose full Ralphy comments) is
 * returned unchanged; otherwise the marker line is appended.
 */
export function ensureStickyMarker(type: RalphyCommentType, body: string): string {
  if (parseRalphyMarker(body)) return body;
  return `${body}\n\n${buildRalphyMarker(type)}`;
}

/** The capability extras a backend supplies on top of its
 *  {@link IssueTrackerProvider} to complete the {@link IssueTracker} facade. */
export interface IssueTrackerExtras {
  upsertStickyComment: (
    issue: TrackedIssue,
    type: RalphyCommentType,
    body: string,
  ) => Promise<void>;
  fetchPullRequestLinks: (issue: TrackedIssue) => Promise<string[]>;
  fetchBlockers: (issueId: string) => Promise<{ id: string; identifier: string }[]>;
  /** Omit (or pass null) when the backend has no attachment concept. */
  attachments?: IssueAttachments | null;
}

/**
 * Assemble the {@link IssueTracker} facade from a provider plus its capability
 * extras. `poll()` batches the provider's bucket fetches concurrently — the
 * single fetch entry point the coordinator drives each cycle.
 */
export function createIssueTracker(
  provider: IssueTrackerProvider,
  extras: IssueTrackerExtras,
): IssueTracker {
  return {
    async poll(): Promise<PollSnapshot> {
      const [todo, inProgress, mentions, doneCandidates] = await Promise.all([
        provider.fetchTodo(),
        provider.fetchInProgress(),
        provider.fetchMentions(),
        provider.fetchDoneCandidates(),
      ]);
      return { todo, inProgress, mentions, doneCandidates };
    },
    applyIndicator: (issue, indicator) => provider.applyIndicator(issue, indicator),
    removeIndicator: (issue, indicator) => provider.removeIndicator(issue, indicator),
    postComment: (issue, body) => provider.postComment(issue, body),
    fetchComments: (issueId) => provider.fetchComments(issueId),
    upsertStickyComment: (issue, type, body) =>
      extras.upsertStickyComment(issue, type, ensureStickyMarker(type, body)),
    fetchPullRequestLinks: (issue) => extras.fetchPullRequestLinks(issue),
    fetchBlockers: (issueId) => extras.fetchBlockers(issueId),
    attachments: extras.attachments ?? null,
  };
}
