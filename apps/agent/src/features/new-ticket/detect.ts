import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The new-ticket slice does NOT participate in the per-poll feature walk —
 * fresh-todo pickup runs through `fetchTodo` in the coordinator, which
 * still owns the queueing path. The slice exists as a shell so the
 * registry has a typed descriptor for the `new-ticket` id and future
 * extraction can drop the legacy branch in one step.
 */
export async function detectNewTicket(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
