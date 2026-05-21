import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The awaiting-ci slice matches when the router has dispatched the
 * issue to this flow. The runtime layer puts the assignment on the
 * `poll` context (when wired); today, no detector triggers via the
 * legacy per-poll walk, so `detect` returns `null` unless the runtime
 * stuck an `awaiting-ci` assignment onto the context.
 */
export async function detectAwaitingCi(ctx: FeatureCtx): Promise<FeatureMatch | null> {
  const assignment = (ctx.poll as { flowAssignment?: { flowId?: string } } | undefined)
    ?.flowAssignment;
  if (assignment?.flowId === "awaiting-ci") {
    return { reason: "router:awaiting-ci" };
  }
  return null;
}
