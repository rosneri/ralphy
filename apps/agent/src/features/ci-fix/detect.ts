import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The ci-fix slice does NOT participate in the per-poll feature walk —
 * CI status is only meaningful after a worker iteration finishes and a
 * push has happened. The slice is `postTask`-only, so `detect` always
 * returns `null`.
 */
export async function detectCiFix(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
