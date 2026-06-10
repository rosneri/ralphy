/**
 * RFC #402 — the gh-driven PR merge-state scan, with effects as data.
 *
 * The watcher walks the done-candidate tickets, reads each PR's merge/CI
 * state, and drives the flow machine (which owns the demote-vs-quarantine
 * decision and the comment-dedup facts). Everything that touches the tracker
 * — comments, indicators, queueing — is returned as {@link PrScanEffect}s for
 * the shell to apply, so the scan itself is testable with scripted PR
 * statuses and no tracker fake.
 */
import type { FailureReason, FlowDirector, FlowRef, FlowSnapshotView } from "@ralphy/core/machines";
import type { TrackedIssue } from "@ralphy/tracker";

export type PrStatusBucket = "mergeable" | "conflicted" | "ci_failed" | "unknown";

/** Per-status counts across the done-candidate PRs scanned this tick.
 *  Surfaced in the dashboard so operators can see at a glance how many
 *  shipped PRs are mergeable, blocked by merge conflicts, or red on CI. */
export interface PrStatusCounts {
  mergeable: number;
  conflicted: number;
  ciFailed: number;
  /** Conflicting / CI-failed PRs whose auto-recovery is exhausted — counted as
   *  a standing level each scan (not a one-shot delta) so the dashboard shows
   *  how many PRs are stuck needing a human. */
  quarantined: number;
}

export const emptyPrStatus = (): PrStatusCounts => ({
  mergeable: 0,
  conflicted: 0,
  ciFailed: 0,
  quarantined: 0,
});

export type PrScanEffect =
  /** Queue a fix worker for a red PR. `fresh` distinguishes a detection made
   *  this scan (telemetry + log + maybe comment) from a resumed session that
   *  only needs its worker back (the post-restart case). */
  | {
      kind: "enqueue-fix";
      issue: TrackedIssue;
      trigger: "conflict-fix" | "ci-fix";
      prUrl: string;
      fresh: boolean;
      /** Post the detection comment (and stamp the snapshot) — false when the
       *  current recovery session was already notified. */
      notifyDetection: boolean;
    }
  /** The PR is mergeable and the ticket may advance to done (merge fallback,
   *  setDone, PR_PASSED, comment — all tracker writes live in the shell). */
  | { kind: "advance-done"; issue: TrackedIssue; prUrl: string }
  /** Auto-recovery exhausted — apply setError + give-up comment once. */
  | { kind: "bail"; issue: TrackedIssue; prUrl: string; reason: FailureReason; attempts: number };

export interface PrScanResult {
  counts: PrStatusCounts;
  effects: PrScanEffect[];
  /** Per-issue PR url + status discovered this scan, keyed by issue.id.
   *  Reuses the `checkPrStatus` calls already made — no new `gh` calls — so
   *  the board can surface a `↗#NNN` link on parked rows. Only the scanned
   *  candidates are present (active / queued / pending issues are skipped). */
  prByIssue: Map<string, { url: string; status: PrStatusBucket }>;
}

export interface PrWatcherDeps {
  fetchDoneCandidates: () => Promise<TrackedIssue[]>;
  checkPrStatus: (issue: TrackedIssue) => Promise<{ url: string; status: PrStatusBucket } | null>;
  director: FlowDirector;
  flowRef: (issue: TrackedIssue) => FlowRef;
  /** True when the issue already carries the setDone marker(s) — the advance
   *  then settles the actor silently instead of re-applying the indicator. */
  issueInSetDoneState: (issue: TrackedIssue) => boolean;
  /** True when a human cleared the quarantine label to request a retry. */
  errorMarkerCleared: (issue: TrackedIssue) => boolean;
  onLog: (text: string, color?: string) => void;
}

export interface PrRecoveryGates {
  enabled: boolean;
  fixCi: boolean;
  fixConflicts: boolean;
}

export class PrWatcher {
  constructor(
    private readonly deps: PrWatcherDeps,
    private readonly recovery: PrRecoveryGates | undefined,
  ) {}

  /**
   * One merge-state scan. `skipIds` are tickets with an active, pending, or
   * queued worker (their state is in flight — the scan leaves them alone).
   * `preexistingFix` carries the conflict-fix / ci-fix items already queued or
   * running before this scan, so the standing-level counters stay accurate
   * without double-counting this scan's own effects.
   */
  async scan(args: {
    skipIds: ReadonlySet<string>;
    preexistingFix: { conflicted: number; ciFailed: number };
  }): Promise<PrScanResult> {
    const counts = emptyPrStatus();
    const effects: PrScanEffect[] = [];
    const prByIssue = new Map<string, { url: string; status: PrStatusBucket }>();
    // RLF-97: `prRecovery.enabled: false` turns recovery off everywhere — the
    // scan becomes a no-op (no recovery and no move-to-done).
    if (!this.recovery?.enabled) return { counts, effects, prByIssue };

    let candidates: TrackedIssue[] = [];
    try {
      candidates = await this.deps.fetchDoneCandidates();
    } catch (err) {
      this.deps.onLog(`! PR merge-state scan fetch failed: ${(err as Error).message}`, "yellow");
      return { counts, effects, prByIssue };
    }
    if (candidates.length === 0) return { counts, effects, prByIssue };

    for (const issue of candidates) {
      if (args.skipIds.has(issue.id)) continue;

      let view = await this.deps.director.view(this.deps.flowRef(issue));

      // Quarantine retry: a human cleared the `setError` label to ask for a
      // fresh attempt. Reset the machine's recovery counter and re-engage —
      // otherwise a bail only clears when the PR becomes mergeable, which a
      // conflicting PR can never reach on its own, so the ticket stays stuck.
      // Non-looping: a subsequent re-bail re-applies setError, so it won't
      // reset again until a human clears the label once more.
      if (view.value === "quarantined" && this.deps.errorMarkerCleared(issue)) {
        view = await this.deps.director.dispatch(this.deps.flowRef(issue), {
          type: "QUARANTINE_CLEARED",
        });
        this.deps.onLog(
          `  ${issue.identifier}: quarantine cleared (ralph:error removed) — retrying recovery`,
          "cyan",
        );
      }

      let pr: { url: string; status: PrStatusBucket } | null;
      try {
        pr = await this.deps.checkPrStatus(issue);
      } catch (err) {
        this.deps.onLog(
          `! PR status check failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      if (!pr) continue;
      // Capture the PR url + status before the recovery gates below so the
      // board surfaces a link even when `fixCi` / `fixConflicts` is off and
      // the scan otherwise skips this PR without queueing recovery.
      prByIssue.set(issue.id, pr);

      if (pr.status === "mergeable") {
        counts.mergeable += 1;
        if (view.value === "awaiting-ci" || view.value === "quarantined") {
          if (this.deps.issueInSetDoneState(issue)) {
            // Already in the setDone state but the actor still rests in
            // awaiting-ci / quarantined — settle to done without re-applying
            // the indicator (which would post a spurious "moving to done"
            // comment).
            await this.deps.director.dispatch(
              this.deps.flowRef(issue),
              { type: "RECOVERY_CLEARED" },
              { type: "PR_PASSED" },
            );
            this.deps.director.disposeIfDone(issue.id);
          } else {
            effects.push({ kind: "advance-done", issue, prUrl: pr.url });
          }
        } else {
          // Not in an advanceable state — still drop a stale recovery record
          // so the board does not keep showing a now-green PR as failing.
          await this.deps.director.dispatch(this.deps.flowRef(issue), {
            type: "RECOVERY_CLEARED",
          });
        }
        continue;
      }

      if (pr.status === "conflicted") {
        // RLF-97: conflict recovery is gated on `fixConflicts`. When off,
        // leave the conflicting PR for a human — no queue, no bail, no count
        // (the watcher still advances it once a human resolves the conflict
        // and it becomes mergeable). Mirrors the `fixCi` gate below.
        if (!this.recovery.fixConflicts) continue;
        await this.handleRed(issue, view, pr.url, "conflicting", counts, effects);
        continue;
      }

      if (pr.status === "ci_failed") {
        // RLF-97: CI recovery is gated on `fixCi`. When off, leave a CI-red
        // PR alone — no queue, no bail, no count. A human owns the checks.
        if (!this.recovery.fixCi) continue;
        await this.handleRed(issue, view, pr.url, "ci_failed", counts, effects);
      }
    }

    // Fix items already queued or running were detected in a prior scan and
    // skipped above — add them so the standing-level counter stays accurate.
    counts.conflicted += args.preexistingFix.conflicted;
    counts.ciFailed += args.preexistingFix.ciFailed;

    return { counts, effects, prByIssue };
  }

  /** One red (conflicting / CI-failed) candidate PR. Mutates `counts` as a
   *  standing level (every currently-red PR counts each scan). */
  private async handleRed(
    issue: TrackedIssue,
    view: FlowSnapshotView,
    prUrl: string,
    reason: FailureReason,
    counts: PrStatusCounts,
    effects: PrScanEffect[],
  ): Promise<void> {
    const trigger = reason === "conflicting" ? ("conflict-fix" as const) : ("ci-fix" as const);
    // Already-quarantined tickets are surfaced as such — no re-route, no
    // re-count. The bail notification is retried only when the stamp is
    // missing (a crash landed between the transition and the comment), which
    // keeps the give-up comment once-only across restarts.
    if (view.value === "quarantined") {
      counts.quarantined += 1;
      if (!view.recovery?.bailNotifiedAt) {
        effects.push({
          kind: "bail",
          issue,
          prUrl,
          reason,
          attempts: view.recovery?.attempts ?? 0,
        });
      }
      return;
    }
    if (reason === "conflicting") counts.conflicted += 1;
    else counts.ciFailed += 1;
    // Mid-session already (fix state persisted from an earlier poll — or from
    // a previous process: the restart case). Do NOT re-send the detection
    // (`attempts` counts recovery sessions, not polls) and do NOT re-post the
    // comment; just make sure a fix worker actually exists. After a restart
    // the queue is empty, so without this re-enqueue a ticket stranded in a
    // fix state would never recover.
    if (view.value === "conflict-fix" || view.value === "ci-fix") {
      effects.push({
        kind: "enqueue-fix",
        issue,
        trigger,
        prUrl,
        fresh: false,
        notifyDetection: false,
      });
      return;
    }
    // Drive the flow machine — it owns the demote-vs-quarantine decision.
    const after = await this.deps.director.dispatch(
      this.deps.flowRef(issue),
      { type: "RESUME_DETECTED" },
      reason === "conflicting"
        ? { type: "CONFLICT_DETECTED", at: new Date().toISOString(), prUrl }
        : { type: "CI_FAILED_DETECTED", at: new Date().toISOString(), prUrl },
    );
    if (after.value === "quarantined") {
      // This detection just tipped the ticket into quarantine — reclassify
      // from "Ralph is recovering" to "needs a human" and bail once.
      if (reason === "conflicting") counts.conflicted -= 1;
      else counts.ciFailed -= 1;
      counts.quarantined += 1;
      effects.push({
        kind: "bail",
        issue,
        prUrl,
        reason,
        attempts: after.recovery?.attempts ?? 0,
      });
      return;
    }
    effects.push({
      kind: "enqueue-fix",
      issue,
      trigger,
      prUrl,
      fresh: true,
      notifyDetection: !after.recovery?.detectionNotifiedAt,
    });
  }
}
