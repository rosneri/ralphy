export interface StaleSignalInputs {
  /** ISO timestamp of last known update. null → unknown age, treated as not-stale. */
  updatedAt: string | null;
  /** Current time in milliseconds (injected for testability). */
  nowMs: number;
  /** Staleness threshold in milliseconds. Boundary is exclusive (age > ttlMs). */
  ttlMs: number;
}

/**
 * True when the signal's age strictly exceeds ttlMs.
 * A null updatedAt is treated as not-stale to avoid false positives on
 * newly-created signals that have no recorded timestamp.
 */
export function isStaleSignal(inputs: StaleSignalInputs): boolean {
  if (inputs.updatedAt === null) return false;
  const age = inputs.nowMs - Date.parse(inputs.updatedAt);
  return age > inputs.ttlMs;
}
