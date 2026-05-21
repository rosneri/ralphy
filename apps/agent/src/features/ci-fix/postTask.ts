import type { FeatureCtx, TaskResult } from "../types";
import { emitCompleted, emitFailed } from "./events";
import { writeLastChecked } from "./state";

/**
 * After each worker task, verify the PR's CI is green.
 *
 * This is **verification only** — the per-iteration "fix CI until green"
 * loop still lives in `post-task.ts`'s `fixConflictsAndCiLoop` until the
 * stage-final cleanup deletes it. This slice asks the `getCiStatus`
 * capability for the PR's current check bucket and emits an event:
 *
 *   - `pass`    → `feature.ci-fix.completed { outcome: "pass" }`
 *   - `fail`    → `feature.ci-fix.failed { error: "ci-failing" }`
 *   - `pending` → `feature.ci-fix.completed { outcome: "pending" }`
 *   - `unknown` → `feature.ci-fix.completed { outcome: "unknown" }`
 *
 * Skipped when:
 *   - `caps.ciFix` is not wired (today's wire layer — the legacy
 *     `post-task.ts` arm still owns the verify path until cleanup),
 *   - the worker exited non-zero (no PR to check against),
 *   - the worker did not produce a branch (no PR to check against).
 */
export async function ciFixPostTask(ctx: FeatureCtx, result: TaskResult): Promise<void> {
  if (!ctx.caps.ciFix) return;
  if (result.exitCode !== 0) return;
  if (!result.branch) return;

  const bucket = await ctx.caps.ciFix.getCiStatus();
  try {
    await writeLastChecked(ctx.state, ctx.now().toISOString(), bucket);
  } catch {
    // state writes are best-effort — a wire layer that hasn't registered
    // the ci-fix slot in OWNERSHIP would throw `OwnershipError`. Events
    // are the observable contract; persistence is opportunistic.
  }
  if (bucket === "fail") {
    emitFailed(ctx.bus, "ci-failing");
    return;
  }
  emitCompleted(ctx.bus, bucket);
}
