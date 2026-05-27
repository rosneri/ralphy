import { join } from "node:path";

/**
 * Per-issue recovery counter for the PR tracker. `attempts` increments
 * each time the scheduler detects a CONFLICTING or CI-failed PR and
 * demotes the issue back to In Progress. Once attempts hits the
 * configured `maxRecoveryAttempts`, the entry is marked `bailed` and the
 * scheduler stops auto-demoting (and applies `setError` once). Cleared
 * when the PR transitions to mergeable / merged, or when a human clears
 * the `ralph:error` label out-of-band.
 */
export interface PrTrackerEntry {
  attempts: number;
  firstFailedAt: string;
  lastDemotedAt: string;
  bailed?: boolean;
  /** Last failure reason persisted, used by the bail comment. */
  lastReason?: "conflicting" | "ci_failed";
}

export type PrTrackerState = Record<string, PrTrackerEntry>;

export const PR_TRACKER_STATE_RELPATH = ".ralph/pr-tracker-state.json";

export async function readState(projectRoot: string): Promise<PrTrackerState> {
  const path = join(projectRoot, PR_TRACKER_STATE_RELPATH);
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PrTrackerState;
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeState(projectRoot: string, state: PrTrackerState): Promise<void> {
  const path = join(projectRoot, PR_TRACKER_STATE_RELPATH);
  await Bun.write(path, JSON.stringify(state, null, 2));
}
