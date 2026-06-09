/**
 * Tracker-neutral issue and comment shapes.
 *
 * These were extracted from the Linear GraphQL client as part of RLF-223
 * (M1 — provider seam) and are the canonical, provider-neutral types every
 * consumer (coordinator/queue/wire layers, the Linear client, the GitHub
 * tracker) depends on directly (RLF-227 retired the Linear-named aliases).
 * A second tracker source (GitHub Issues, M2) populates the same shape from
 * its own backend.
 */

export interface TrackedComment {
  id: string;
  body: string;
  createdAt: string;
  user: { name: string; email: string | null } | null;
}

export interface TrackedIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  assignee: { id: string; email: string | null; name: string } | null;
  /** Tracker project the issue belongs to, or null when unassigned. */
  project: { id: string; name: string; priority?: number } | null;
  /**
   * Project milestone the issue is assigned to, or undefined when none.
   * `sortOrder` reflects the milestone's manual ordering within its project.
   */
  milestone?: { id: string; name: string; sortOrder: number; targetDate?: string };
  labels: string[];
  /** Priority: 1=Urgent, 2=High, 3=Medium, 4=Low, 0=No priority */
  priority: number;
  /** ISO timestamp of issue creation — used as a FIFO tiebreaker in the
   *  coordinator queue so older same-priority work runs first. */
  createdAt: string;
  /**
   * IDs of issues that block this one and are not yet completed/cancelled.
   * Populated from the tracker's "blocked_by" relations.
   */
  blockedByIds: string[];
  /**
   * Identifiers (e.g. "ENG-123") of open blockers.
   * Populated alongside blockedByIds from the same relations.
   */
  blockedByIdentifiers?: string[];
  /**
   * Recent comments embedded with the mention-scan candidate query so the
   * agent can skip a per-issue comment round-trip. Only populated by the
   * mention scanner; absent on issues returned by other fetchers.
   */
  comments?: TrackedComment[];
}
