import type { FeatureCtx } from "../types";

/**
 * `run` is unreachable for the stuck slice — its `detect` always
 * returns `null`. Kept as a typed no-op so the `Feature` contract stays
 * uniform with sibling slices.
 */
export async function runStuck(_ctx: FeatureCtx): Promise<void> {
  // intentional no-op
}
