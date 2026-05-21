/**
 * Shared shell for invoking a `Feature`'s `detect` and `run` callbacks
 * from the registry walk in `coordinator.ts`.
 *
 * Two guarantees the registry walk depends on:
 *
 *   1. Neither helper ever throws. A feature whose `detect` or `run`
 *      raises emits `feature.<id>.failed { error }` and returns control
 *      to the coordinator so lower-priority features still get a turn.
 *   2. The bus event sequence is fixed:
 *        - `detectFeature` emits nothing on a clean null match (the
 *          common case — most polls don't match most features).
 *        - `detectFeature` emits `feature.<id>.failed` on throws.
 *        - `runFeature` emits `feature.<id>.detected { reason }`,
 *          then `feature.<id>.started`, then either
 *          `feature.<id>.completed` or `feature.<id>.failed { error }`.
 *        - `emitFeatureSkipped` is the coordinator's hook for losers
 *          when a higher-priority feature preempts them on the same poll.
 */

import type { Bus, EmitInput } from "@ralphy/events";
import type { Feature, FeatureCtx, FeatureId, FeatureMatch } from "./types";

function emit(bus: Bus, type: string, payload: Record<string, unknown> = {}): void {
  bus.emit({ type, ...payload } as unknown as EmitInput);
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "unknown error";
  }
}

/**
 * Invoke `feature.detect(ctx)` under try/catch. Returns the match on
 * success, `null` on either no-match or thrown error. A throw emits
 * `feature.<id>.failed { error, phase: "detect" }` so the failure is
 * observable in telemetry — but it does NOT propagate, because a
 * broken detector MUST NOT block the rest of the registry walk.
 */
export async function detectFeature(
  feature: Feature,
  ctx: FeatureCtx,
): Promise<FeatureMatch | null> {
  try {
    return await feature.detect(ctx);
  } catch (err) {
    emit(ctx.bus, `feature.${feature.id}.failed`, {
      error: formatError(err),
      phase: "detect",
    });
    return null;
  }
}

/**
 * Invoke `feature.run(ctx, match)` under try/catch with the surrounding
 * `detected` / `started` / `completed` / `failed` events. Never throws.
 */
export async function runFeature(
  feature: Feature,
  ctx: FeatureCtx,
  match: FeatureMatch,
): Promise<void> {
  emit(ctx.bus, `feature.${feature.id}.detected`, { reason: match.reason });
  emit(ctx.bus, `feature.${feature.id}.started`, { reason: match.reason });
  try {
    await feature.run(ctx, match);
    emit(ctx.bus, `feature.${feature.id}.completed`, {});
  } catch (err) {
    emit(ctx.bus, `feature.${feature.id}.failed`, {
      error: formatError(err),
      phase: "run",
    });
  }
}

/**
 * Emit `feature.<id>.skipped { reason }` for detectors the coordinator
 * chose not to run this poll (e.g. preempted by a higher-priority
 * match). Keeps telemetry symmetric with the `detected` event.
 */
export function emitFeatureSkipped(bus: Bus, id: FeatureId, reason: string): void {
  emit(bus, `feature.${id}.skipped`, { reason });
}
