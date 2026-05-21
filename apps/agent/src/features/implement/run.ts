import type { FeatureCtx } from "../types";

/**
 * `run` is unreachable for the implement slice — its `detect` always
 * returns `null`. Kept as a typed no-op so the `Feature` contract stays
 * uniform with sibling slices.
 */
export async function runImplement(_ctx: FeatureCtx): Promise<void> {
  // intentional no-op
}
