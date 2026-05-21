import type { FeatureCtx, TaskResult } from "../types";
import { emitCompleted, emitFailed, emitTransitioned } from "./events";
import { writePrUrl, writeFlow } from "./state";

/**
 * After each worker task, verify a PR has been opened for the branch and
 * record its URL under `state.pr`.
 *
 * This is **verification only** — the push + hook-fix retry loop and the
 * `gh pr create` call still live in `post-task.ts`'s `runPrPhase` /
 * `createPrWithRetry` until the stage-final cleanup deletes them. This
 * slice asks the `getPrUrl` capability for the PR URL and emits an event:
 *
 *   - PR found      → `feature.implement.completed { outcome: "opened", prUrl }`
 *   - PR not found  → `feature.implement.failed { error: "no-pr" }`
 *
 * Skipped when:
 *   - `caps.implement` is not wired (today's wire layer — the legacy
 *     `post-task.ts` arm still owns the PR-create path until cleanup),
 *   - the worker exited non-zero (PR phase already skipped),
 *   - the worker did not produce a branch (no PR to look up).
 */
export async function implementPostTask(ctx: FeatureCtx, result: TaskResult): Promise<void> {
  if (!ctx.caps.implement) return;
  if (result.exitCode !== 0) return;
  if (!result.branch) return;

  const url = await ctx.caps.implement.getPrUrl();
  if (!url) {
    emitFailed(ctx.bus, "no-pr");
    return;
  }
  try {
    await writePrUrl(ctx.state, url, ctx.now().toISOString());
    await writeFlow(ctx.state, "awaiting-ci");
  } catch {
    // state writes are best-effort — a wire layer that hasn't registered
    // the implement slot in OWNERSHIP would throw `OwnershipError`. Events
    // are the observable contract; persistence is opportunistic.
  }
  emitCompleted(ctx.bus, "opened", url);
  emitTransitioned(ctx.bus, "awaiting-ci");
}
