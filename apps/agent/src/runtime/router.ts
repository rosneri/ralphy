import type { FlowAssignment, RouterRow, RouterSignals } from "./types";

/**
 * Precedence table. Ordered top-down; first match wins. The last row is
 * the `idle` catch-all so `route(signals)` is total over the signal
 * space.
 */
export const ROUTER_TABLE: readonly RouterRow[] = [
  {
    name: "awaiting → revise",
    when: (s) => s.awaiting === "revise" || s.mention === "revise",
    flowId: "confirmation",
  },
  {
    name: "awaiting → confirm",
    when: (s) => s.awaiting === "awaiting",
    flowId: "confirmation",
  },
  {
    name: "pr conflicting",
    when: (s) => s.prStatus === "conflicting" || s.bucket === "conflicted",
    flowId: "conflict-fix",
  },
  {
    name: "pr ci failing",
    when: (s) => s.prStatus === "ci-failing",
    flowId: "ci-fix",
  },
  {
    // Idle catch-up: a previous poll opened a PR and asked the router to
    // keep watching, but CI has since gone green. The slice emits a
    // `completed` event and the router falls through to the bucket-based
    // rows on subsequent polls (handled because `prStatus !== "ci-pending"`
    // would otherwise drop back to implement). This row sits ABOVE
    // `awaiting-ci watch` so a settled pass is recognised before the
    // pending-watch row keeps the issue parked.
    name: "awaiting-ci pass",
    when: (s) => s.awaitingCi === "watching" && s.prStatus === "mergeable",
    flowId: "awaiting-ci",
  },
  {
    name: "awaiting-ci watch",
    when: (s) => s.awaitingCi === "watching",
    flowId: "awaiting-ci",
  },
  {
    name: "review bucket",
    when: (s) => s.bucket === "review",
    flowId: "review-followup",
  },
  {
    name: "stuck",
    when: (s) => s.stuck === true,
    flowId: "stuck",
  },
  {
    name: "new ticket",
    when: (s) => s.bucket === "todo" && s.mention === "new-ticket",
    flowId: "new-ticket",
  },
  {
    name: "mention catch-all",
    when: (s) => s.mention !== "none",
    flowId: "mention",
  },
  {
    name: "in-progress implement",
    when: (s) => s.bucket === "in-progress",
    flowId: "implement",
  },
  {
    name: "todo implement",
    when: (s) => s.bucket === "todo",
    flowId: "implement",
  },
  {
    name: "idle catch-all",
    when: () => true,
    flowId: "idle",
  },
] as const;

/** Pure router. Total over the signal space — the last row matches all. */
export function route(signals: RouterSignals): FlowAssignment {
  for (const row of ROUTER_TABLE) {
    if (row.when(signals)) {
      return { flowId: row.flowId, reason: row.name, boost: signals.boost };
    }
  }
  // Unreachable: the last row is `() => true`. Kept so the function
  // remains total even if the table is mutated by a future caller.
  return { flowId: "idle", reason: "idle catch-all", boost: signals.boost };
}
