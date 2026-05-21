import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The mention slice does NOT participate in the per-poll feature walk —
 * `fetchMentions` in the coordinator (and the mention-scan glue inside
 * `wire.ts`) still owns the queueing path. The slice exists as a shell so
 * the registry has a typed descriptor for the `mention` id and emits the
 * `feature.mention.reviseComment` signal the confirmation slice consumes
 * to advance its own state — keeping the cross-feature seam observable on
 * the bus instead of through a shared state write.
 */
export async function detectMention(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
