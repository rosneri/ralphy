import type { Marker, SetIndicator } from "@ralphy/types";
import type { LinearIssue } from "../../linear";

/**
 * The subset of {@link LinearIssue} the loop actually reads off a fetched
 * issue. A {@link TrackerProvider} that is not Linear-backed (e.g. the GitHub
 * Issues provider) only has to populate these fields; the remaining
 * `LinearIssue` fields are filled with inert defaults. `LinearIssue` is
 * structurally assignable to `TrackerIssue`, so the Linear path is unchanged.
 */
export interface TrackerIssue {
  /** Provider-stable id (Linear uuid; GitHub issue number as a string). */
  id: string;
  /** Display key used for branch naming + PR-title search (e.g. `ENG-12`, `#42`). */
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  labels: string[];
}

/**
 * The tracker operations the agent loop drives. Both `createLinearResolvers`
 * and `createGithubTrackerProvider` conform to this so `wire.ts` can select a
 * provider by `tracker.kind` and thread it wherever the resolvers are used
 * today. The concrete issue type is `LinearIssue` (the loop's existing type);
 * providers only need to read the {@link TrackerIssue} subset of it.
 */
export interface TrackerProvider {
  /** Fetch open issues matching a get-indicator filter, minus the excludes. */
  fetchByGet: (
    inc: SetIndicator | { filter: Marker[] } | undefined,
    excl: Marker[],
  ) => Promise<LinearIssue[]>;
  /** Apply every marker of a set-indicator (e.g. setInProgress / setDone). */
  applyIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  /** Remove the label markers of a set-indicator (status removal is a no-op). */
  removeIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  /** Apply a single marker (used by the confirmation gate). */
  applyMarker: (issue: LinearIssue, m: Marker) => Promise<void>;
  /** Issues to scan for PR conflict / CI status (in-progress / done buckets). */
  fetchDoneCandidates: () => Promise<LinearIssue[]>;
  /** Linear-only: resolve (creating if needed) a label id for a raw team key.
   *  Providers without the concept return null. */
  resolveLabelIdForTeam: (
    teamKey: string,
    labelName: string,
    group?: string,
  ) => Promise<string | null>;
}
