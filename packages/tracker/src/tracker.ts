import type { SetIndicator } from "@ralphy/types";
import type { RalphyCommentType } from "@ralphy/comms";
import type { TrackedIssue } from "./issue";
import type { MentionTrigger } from "./mention";

/**
 * One bundle per poll cycle (issue #403). The facade batches the provider's
 * bucket fetches internally so the coordinator issues a single `poll()` and
 * never sequences individual fetches itself.
 */
export interface PollSnapshot {
  todo: TrackedIssue[];
  inProgress: TrackedIssue[];
  mentions: { issue: TrackedIssue; trigger: MentionTrigger }[];
  /** Issues whose PRs the merge-state watcher scans. `blockedByIds` is
   *  populated on every TrackedIssue by the provider. */
  doneCandidates: TrackedIssue[];
}

/**
 * Optional attachment capability (Linear-only today). Callers feature-test
 * (`tracker.attachments?.…`) — absence is the signal; nobody branches on the
 * tracker kind. A genuinely new provider-specific feature must be modeled as a
 * new capability, not a port method.
 */
export interface IssueAttachments {
  /** Upload file bytes to the tracker's asset store; returns the asset URL. */
  uploadFile(input: { filename: string; contentType: string; bytes: Uint8Array }): Promise<string>;
  /** Attach a URL to the issue; returns the created attachment's id. */
  attachUrl(issueId: string, url: string, title: string, subtitle?: string): Promise<string>;
  /** Exact-title lookup; returns the attachment id or null. */
  findByTitle(issueId: string, title: string): Promise<string | null>;
  delete(attachmentId: string): Promise<void>;
}

/**
 * The issue-tracker facade (issue #403) — the complete surface the
 * orchestration core consumes. Built over an {@link IssueTrackerProvider} via
 * `createIssueTracker`; concrete backends only add the capability extras
 * (sticky upsert, PR links, blockers, attachments).
 */
export interface IssueTracker {
  /** One bundle per poll cycle; the provider batches internally. */
  poll(): Promise<PollSnapshot>;

  applyIndicator(issue: TrackedIssue, indicator: SetIndicator): Promise<void>;
  removeIndicator(issue: TrackedIssue, indicator: SetIndicator): Promise<void>;

  postComment(issue: TrackedIssue, body: string): Promise<void>;
  fetchComments(issueId: string): Promise<{ body: string }[]>;
  /** Marker-idempotent upsert using `@ralphy/comms` sticky markers: N applies
   *  converge on exactly one comment of `type` carrying the latest body.
   *  Best-effort — implementations log-and-swallow transport failures. */
  upsertStickyComment(issue: TrackedIssue, type: RalphyCommentType, body: string): Promise<void>;

  /** PR URLs recorded on the issue (Linear: attachments; GitHub: PR search). */
  fetchPullRequestLinks(issue: TrackedIssue): Promise<string[]>;
  /** Provider-neutral blocker refresh (replaces the Linear-only
   *  `fetchBlockedByForIssues` path). May be heuristic on backends without a
   *  first-class blocked-by relation — blockers are advisory to the loop. */
  fetchBlockers(issueId: string): Promise<{ id: string; identifier: string }[]>;

  /** Narrow capability side-door; null when unsupported. Callers feature-test,
   *  never branch on kind. */
  readonly attachments: IssueAttachments | null;
}
