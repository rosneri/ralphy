import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The implement slice does NOT participate in the per-poll feature walk —
 * implementation work runs as the default worker iteration (every poll
 * that doesn't get claimed by a more specific feature). The slice is
 * `postTask`-only, so `detect` always returns `null`.
 */
export async function detectImplement(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
