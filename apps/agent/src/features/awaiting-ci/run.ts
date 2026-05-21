import type { FeatureCtx } from "../types";
import { emitCompleted, emitFailed } from "./events";

/**
 * Calls `caps.ciFix.getCiStatus()` exactly once and emits exactly one
 * event based on the result:
 *
 *   - `pass`    → `feature.awaiting-ci.completed { outcome: "pass" }`
 *   - `fail`    → `feature.awaiting-ci.failed { error: "ci-failing" }`
 *   - `pending` → `feature.awaiting-ci.completed { outcome: "pending" }`
 *   - `unknown` → `feature.awaiting-ci.completed { outcome: "unknown" }`
 *
 * The slice is intentionally side-effect-free aside from the bus emit
 * and the single `gh` call inside `getCiStatus`. No worker is spawned;
 * no slot is acquired.
 */
export async function runAwaitingCi(ctx: FeatureCtx): Promise<void> {
  if (!ctx.caps.ciFix) {
    emitFailed(ctx.bus, "missing-ci-fix-cap");
    return;
  }
  const bucket = await ctx.caps.ciFix.getCiStatus();
  if (bucket === "fail") {
    emitFailed(ctx.bus, "ci-failing");
    return;
  }
  emitCompleted(ctx.bus, bucket);
}
