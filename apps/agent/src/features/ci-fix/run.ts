import type { FeatureCtx } from "../types";

/**
 * `run` is unreachable for the ci-fix slice — its `detect` always
 * returns `null`. Kept as a typed no-op so the `Feature` contract stays
 * uniform with sibling slices.
 */
export async function runCiFix(_ctx: FeatureCtx): Promise<void> {
  // intentional no-op
}
