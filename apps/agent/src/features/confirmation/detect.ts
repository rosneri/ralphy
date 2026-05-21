import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * Detect whether the confirmation feature wants to claim this poll.
 *
 * The actual gate check (config enabled? approval label present? change
 * has unchecked tasks?) lives in `caps.confirmation.detect` so the slice
 * doesn't need to import `@ralphy/core/detections` / `projectLayout` /
 * Linear capabilities directly — wire builds the closure once and hands
 * it through caps. When `caps.confirmation` is absent (e.g. test ctx
 * without confirmation deps wired) we return `null` and let the legacy
 * resume path own the issue.
 */
export async function detectConfirmation(ctx: FeatureCtx): Promise<FeatureMatch | null> {
  const caps = ctx.caps.confirmation;
  if (!caps) return null;
  const claimed = await caps.detect(ctx.issue);
  if (!claimed) return null;
  return { reason: "awaiting-confirmation" };
}
