import type { Marker, SetIndicator } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";

/**
 * The tracker operations the agent loop drives. Both `createLinearResolvers`
 * and `createGithubTrackerProvider` conform to this so `wire.ts` can select a
 * provider by `tracker.kind` and thread it wherever the resolvers are used
 * today. The concrete issue type is the provider-neutral `TrackedIssue` from
 * `@ralphy/tracker`; a non-Linear provider (e.g. GitHub Issues) only has to
 * populate the subset
 * of fields the loop actually reads (`id`, `identifier`, `title`,
 * `description`, `url`, `state`, `labels`) and fills the rest with inert
 * defaults.
 */
export interface TrackerProvider {
  /** Fetch open issues matching a get-indicator filter, minus the excludes. */
  fetchByGet: (
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ) => Promise<TrackedIssue[]>;
  /** Apply every marker of a set-indicator (e.g. setInProgress / setDone). */
  applyIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
  /** Remove the label markers of a set-indicator (status removal is a no-op). */
  removeIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
  /** Apply a single marker (used by the confirmation gate). */
  applyMarker: (issue: TrackedIssue, m: Marker) => Promise<void>;
  /** Issues to scan for PR conflict / CI status (in-progress / done buckets). */
  fetchDoneCandidates: () => Promise<TrackedIssue[]>;
  /** Linear-only: resolve (creating if needed) a label id for a raw team key.
   *  Providers without the concept return null. */
  resolveLabelIdForTeam: (
    teamKey: string,
    labelName: string,
    group?: string,
  ) => Promise<string | null>;
}
