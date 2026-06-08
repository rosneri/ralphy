import type { SetIndicator } from "@ralphy/types";
import type { TrackedIssue } from "./issue";
import type { MentionTrigger } from "./mention";

/**
 * The single seam every issue-tracker backend implements. Promoted from the
 * test harness's latent `LinearClientLike` interface (RLF-223 M1): the
 * coordinator and wire layer depend only on this shape, never on a concrete
 * transport. `LinearTrackerProvider` wraps the existing Linear GraphQL client;
 * a future `GithubTrackerProvider` (M2) implements the same bag over `gh`.
 *
 * The method names mirror the get/set indicator buckets the coordinator polls:
 * `fetch*` read issues by their configured get-indicator; `applyIndicator` /
 * `removeIndicator` write set-indicator markers; `postComment` / `fetchComments`
 * cover comment IO; `fetchMentions` surfaces `@ralphy` review triggers.
 */
export interface IssueTrackerProvider {
  fetchTodo(): Promise<TrackedIssue[]>;
  fetchInProgress(): Promise<TrackedIssue[]>;
  fetchReview(): Promise<TrackedIssue[]>;
  fetchMentions(): Promise<{ issue: TrackedIssue; trigger: MentionTrigger }[]>;
  fetchDoneCandidates(): Promise<TrackedIssue[]>;
  fetchComments(issueId: string): Promise<{ body: string }[]>;
  applyIndicator(issue: TrackedIssue, ind: SetIndicator): Promise<void>;
  removeIndicator(issue: TrackedIssue, ind: SetIndicator): Promise<void>;
  postComment(issue: TrackedIssue, body: string): Promise<void>;
}
