/**
 * `@ralphy/tracker` — the tracker-neutral seam between the agent's
 * orchestration core and a concrete issue-tracker backend (Linear today,
 * GitHub Issues next). See {@link IssueTrackerProvider} (the backend method
 * bag) and {@link IssueTracker} (the complete facade the coordinator
 * consumes, issue #403).
 */
export type { TrackedIssue, TrackedComment } from "./issue";
export type { MentionTrigger } from "./mention";
export type { IssueTrackerProvider } from "./provider";
export type { IssueAttachments, IssueTracker, PollSnapshot } from "./tracker";
export { createIssueTracker, ensureStickyMarker, type IssueTrackerExtras } from "./facade";
