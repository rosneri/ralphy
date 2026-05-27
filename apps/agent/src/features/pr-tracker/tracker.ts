import { readState, writeState, type PrTrackerState, type PrTrackerEntry } from "./state";

export interface PrTrackerOptions {
  projectRoot: string;
  maxRecoveryAttempts: number;
  /** Injected clock for tests. */
  now?: () => Date;
}

export type FailureReason = "conflicting" | "ci_failed";

/** Outcome of recording a failure detection. */
export type FailureDecision =
  | { kind: "demote"; attempts: number }
  | { kind: "bail"; attempts: number; firstBail: boolean };

/**
 * Persistent attempt counter for PRs that ralphy auto-recovers. Loaded
 * once at startup, mutated in-memory on each detection, and flushed to
 * `.ralph/pr-tracker-state.json` after every change. Single-writer
 * (coordinator owns the instance).
 */
export class PrTracker {
  private state: PrTrackerState = {};
  private loaded = false;
  private readonly now: () => Date;

  constructor(private readonly opts: PrTrackerOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.state = await readState(this.opts.projectRoot);
    this.loaded = true;
  }

  /** For tests / inspection. */
  snapshot(): PrTrackerState {
    return JSON.parse(JSON.stringify(this.state));
  }

  isBailed(identifier: string): boolean {
    return this.state[identifier]?.bailed === true;
  }

  getAttempts(identifier: string): number {
    return this.state[identifier]?.attempts ?? 0;
  }

  /**
   * Record a failure detection. Returns whether to demote (and increment)
   * or bail (apply setError once and stop). Subsequent failures after bail
   * return `firstBail: false` so the caller skips re-applying the label
   * and re-commenting on every tick.
   */
  async recordFailure(identifier: string, reason: FailureReason): Promise<FailureDecision> {
    await this.load();
    const nowIso = this.now().toISOString();
    const existing = this.state[identifier];

    if (existing?.bailed) {
      existing.lastReason = reason;
      await this.flush();
      return { kind: "bail", attempts: existing.attempts, firstBail: false };
    }

    const attempts = (existing?.attempts ?? 0) + 1;
    const entry: PrTrackerEntry = {
      attempts,
      firstFailedAt: existing?.firstFailedAt ?? nowIso,
      lastDemotedAt: nowIso,
      lastReason: reason,
    };

    if (attempts >= this.opts.maxRecoveryAttempts) {
      entry.bailed = true;
      this.state[identifier] = entry;
      await this.flush();
      return { kind: "bail", attempts, firstBail: true };
    }

    this.state[identifier] = entry;
    await this.flush();
    return { kind: "demote", attempts };
  }

  /**
   * Clear an entry — call when the PR returns to a healthy state
   * (mergeable, merged, or the human cleared the ralph:error label).
   * No-op when the issue has no entry.
   */
  async clear(identifier: string): Promise<void> {
    await this.load();
    if (!(identifier in this.state)) return;
    delete this.state[identifier];
    await this.flush();
  }

  private async flush(): Promise<void> {
    await writeState(this.opts.projectRoot, this.state);
  }
}
