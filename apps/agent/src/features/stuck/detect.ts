import type { FeatureCtx, FeatureMatch } from "../types";

/**
 * The stuck slice does NOT participate in the per-poll feature walk —
 * the `applyStuckLabel` capability invoked from inside the worker loop
 * (see `wire.ts`'s buildSteeringIo wiring) still owns the legacy path
 * that flags a stuck change. The slice exists as a shell so the registry
 * has a typed descriptor for the `stuck` id and future extraction can
 * drop the legacy branch in one step.
 */
export async function detectStuck(_ctx: FeatureCtx): Promise<FeatureMatch | null> {
  return null;
}
