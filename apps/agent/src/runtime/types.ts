/** Boost band: combines age + Linear priority + mention recency. */
export type BoostBand = "p0" | "p1" | "p2" | "p3";

/** Signals derived from one Linear issue + its PR + bus history. Pure data. */
export interface RouterSignals {
  bucket: "todo" | "in-progress" | "review" | "conflicted" | "done" | "cancelled";
  prStatus: "none" | "mergeable" | "conflicting" | "ci-failing" | "ci-pending" | "unknown";
  awaiting: "none" | "awaiting" | "approved" | "revise";
  mention: "none" | "revise" | "new-ticket" | "stuck";
  stuck: boolean;
  boost: BoostBand;
  /**
   * Whether the issue is currently being watched for CI to settle.
   *
   *   - `"none"`      — no PR open, or CI is not being watched yet.
   *   - `"watching"`  — PR is open, CI has not concluded; the router
   *                     keeps the issue in the `awaiting-ci` flow so the
   *                     coordinator can poll `getCiStatus()` without
   *                     spawning a worker.
   */
  awaitingCi: "none" | "watching";
}

export type FlowId =
  | "confirmation"
  | "conflict-fix"
  | "ci-fix"
  | "awaiting-ci"
  | "review-followup"
  | "implement"
  | "new-ticket"
  | "mention"
  | "stuck"
  | "idle";

/** Output of `route(signals)` — what flow should run for this issue. */
export interface FlowAssignment {
  flowId: FlowId;
  reason: string;
  boost: BoostBand;
}

/** One row in the precedence table. */
export interface RouterRow {
  name: string;
  when: (s: RouterSignals) => boolean;
  flowId: FlowId;
}
