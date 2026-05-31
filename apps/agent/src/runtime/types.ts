import type { BoostBand, FlowId, FlowAssignment } from "@ralphy/core/machines";

export type { BoostBand, FlowId, FlowAssignment };

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

/** One row in the precedence table. */
export interface RouterRow {
  name: string;
  when: (s: RouterSignals) => boolean;
  flowId: FlowId;
}
