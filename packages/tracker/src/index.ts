/**
 * `@ralphy/tracker` — the tracker-neutral seam between the agent's
 * orchestration core and a concrete issue-tracker backend (Linear today,
 * GitHub Issues next). See {@link IssueTrackerProvider}.
 */
export type { TrackedIssue, TrackedComment } from "./issue";
export type { MentionTrigger } from "./mention";
export type { IssueTrackerProvider } from "./provider";
