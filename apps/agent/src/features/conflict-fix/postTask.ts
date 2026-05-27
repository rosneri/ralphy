import type { FeatureCtx, TaskResult } from "../types";
import { emitCompleted, emitFailed } from "./events";

/**
 * After each worker task, verify the PR still merges cleanly.
 *
 * Per RLF-82 the worker iteration owns conflict resolution (push + merge
 * + fix happen inside the AI loop, never rebase or force-push). This
 * `postTask` is **verification
 * only** — it asks the `getMergeability` capability for the PR's current
 * state and emits an event. It never spawns a re-fix task.
 *
 * Skipped when:
 *   - `caps.conflictFix` is not wired (today's wire layer — the legacy
 *     `post-task.ts` arm still owns the verify path until cleanup),
 *   - the worker exited non-zero (no PR to check against),
 *   - the worker did not produce a branch (no PR to check against).
 */
export async function conflictFixPostTask(ctx: FeatureCtx, result: TaskResult): Promise<void> {
  if (!ctx.caps.conflictFix) return;
  if (result.exitCode !== 0) return;
  if (!result.branch) return;

  const state = await ctx.caps.conflictFix.getMergeability();
  if (state === "conflicting") {
    emitFailed(ctx.bus, "pr-conflicting");
    return;
  }
  emitCompleted(ctx.bus, state);
}
