/**
 * RFC #402 — all recurring tracker writes in one place: scan-effect comments
 * (detection / promotion / bail / advance-to-done), periodic progress
 * comments, and the per-poll tasks sync. After a recovery comment lands, the
 * notifier stamps the fact on the flow snapshot (`RECOVERY_NOTIFIED` via the
 * director) so the dedup survives restarts.
 */
import type { GetIndicator, SetIndicator } from "@ralphy/types";
import type { FailureReason, FlowDirector, FlowRef } from "@ralphy/core/machines";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { Bus } from "@ralphy/events";
import { buildRalphyComment } from "@ralphy/comms";
import type { ActiveWorker } from "../types";
import { emitCapture } from "./telemetry";

/** Pull the PR number out of a GitHub pull URL, e.g.
 *  `https://github.com/owner/repo/pull/376` → `376`. Returns null when the
 *  URL doesn't match — callers render the full URL in that case. */
function extractPrNumber(url: string): string | null {
  const m = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return m ? (m[1] ?? null) : null;
}

export interface IssueNotifierDeps {
  postComment: IssueTrackerProvider["postComment"];
  applyIndicator: IssueTrackerProvider["applyIndicator"];
  removeIndicator: IssueTrackerProvider["removeIndicator"];
  /** Merge a verified-mergeable PR directly (the manual-merge fallback). */
  mergePr?: ((prUrl: string) => Promise<boolean>) | undefined;
  getIterationCount?: ((changeName: string) => Promise<number>) | undefined;
  getTasksFingerprint?: ((changeName: string) => Promise<string | null>) | undefined;
  syncTasks?: ((worker: ActiveWorker, iteration: number) => Promise<void>) | undefined;
  director: FlowDirector;
  flowRef: (issue: TrackedIssue) => FlowRef;
  onLog: (text: string, color?: string) => void;
  bus: Bus;
}

export interface IssueNotifierOpts {
  postComments?: boolean | undefined;
  commentEveryIterations?: number | undefined;
  setDone?: SetIndicator | undefined;
  setInProgress?: SetIndicator | undefined;
  setError?: SetIndicator | undefined;
  getAutoMerge?: GetIndicator | undefined;
}

export class IssueNotifier {
  constructor(
    private readonly deps: IssueNotifierDeps,
    private readonly opts: IssueNotifierOpts,
  ) {}

  /** Post the failing-PR detection comment, then stamp the snapshot so the
   *  dedup survives restarts. The stamp lands only after a successful post —
   *  a failed post retries on the next fresh detection rather than going
   *  silent. */
  async notifyDetection(
    issue: TrackedIssue,
    trigger: "conflict-fix" | "ci-fix",
    prUrl: string,
  ): Promise<void> {
    if (this.opts.postComments === false) return;
    try {
      await this.deps.postComment(
        issue,
        buildRalphyComment(
          trigger === "conflict-fix"
            ? {
                type: "conflict-detected",
                action: "detected merge conflicts",
                body: `Detected merge conflicts on this PR (${prUrl}) — re-running to resolve.`,
                fields: { pr: extractPrNumber(prUrl) ?? prUrl },
              }
            : {
                type: "ci-failed",
                action: "detected failing CI",
                body: `Detected failing CI on this PR (${prUrl}) — re-running to fix.`,
                fields: { pr: extractPrNumber(prUrl) ?? prUrl },
              },
        ),
      );
      await this.deps.director.dispatch(this.deps.flowRef(issue), {
        type: "RECOVERY_NOTIFIED",
        kind: "detection",
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.deps.onLog(
        `! Linear ${trigger === "conflict-fix" ? "conflict" : "ci-failed"} comment failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  /** Post the promoted-to-fix-flow comment and stamp the snapshot. */
  async notifyPromotion(
    issue: TrackedIssue,
    trigger: "conflict-fix" | "ci-fix",
    prUrl: string,
    stateLabel: string,
  ): Promise<void> {
    if (this.opts.postComments === false) return;
    const prNum = extractPrNumber(prUrl);
    const ref = prNum !== null ? `PR #${prNum}` : `PR ${prUrl}`;
    try {
      await this.deps.postComment(
        issue,
        buildRalphyComment({
          type: "promoted",
          action: `promoted to ${trigger} flow`,
          body: `${ref} is ${stateLabel} — promoted to ${trigger} flow.`,
          fields: { trigger, pr: extractPrNumber(prUrl) ?? prUrl },
        }),
      );
      this.deps.onLog(`  ${issue.identifier}: posted ${trigger}-promotion comment`, "gray");
      await this.deps.director.dispatch(this.deps.flowRef(issue), {
        type: "RECOVERY_NOTIFIED",
        kind: "promotion",
        at: new Date().toISOString(),
      });
    } catch (err) {
      this.deps.onLog(
        `! Linear ${trigger}-promotion comment failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  /**
   * Auto-recovery exhausted: apply `setError`, post the give-up comment, and
   * stamp `bailNotifiedAt` so the bail stays once-only across restarts.
   */
  async bail(
    issue: TrackedIssue,
    prUrl: string,
    reason: FailureReason,
    attempts: number,
  ): Promise<void> {
    this.deps.onLog(
      `  ${issue.identifier}: quarantined after ${attempts} recovery attempts (${reason}) — applying setError`,
      "red",
    );
    emitCapture(this.deps.bus, "agent_pr_tracker_bailed", {
      issue_identifier: issue.identifier,
      reason,
      attempts,
    });
    if (this.opts.setError) {
      try {
        await this.deps.applyIndicator(issue, this.opts.setError);
      } catch (err) {
        this.deps.onLog(
          `! Linear setError failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    if (this.opts.postComments !== false) {
      const human = reason === "conflicting" ? "merge conflicts" : "failing CI";
      try {
        await this.deps.postComment(
          issue,
          buildRalphyComment({
            type: "recovery-gaveup",
            action: "gave up auto-recovering PR",
            body: `Gave up auto-recovering this PR (${prUrl}) after ${attempts} attempts — last failure: ${human}. The \`ralph:error\` label has been applied; clear it (or merge the PR) once a human has looked at it.`,
            fields: { pr: extractPrNumber(prUrl) ?? prUrl, attempts },
          }),
        );
      } catch (err) {
        this.deps.onLog(
          `! Linear bail comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    // Stamp the bail on the snapshot so it stays once-only across restarts.
    await this.deps.director.dispatch(this.deps.flowRef(issue), {
      type: "RECOVERY_NOTIFIED",
      kind: "bail",
      at: new Date().toISOString(),
    });
  }

  /**
   * RLF-97: advance an in-review ticket to done after its PR became
   * mergeable. The worker deferred `setDone` to the watcher, so this is where
   * the move-to-done actually happens: merge fallback, apply `setDone`, clear
   * the in-progress label, then drive the flow actor to done and dispose it.
   * `setDone` is applied BEFORE the actor transition so that if the tracker
   * write throws the actor stays in `awaiting-ci` and the next scan retries.
   */
  async advanceToDone(issue: TrackedIssue, prUrl: string): Promise<void> {
    // Manual-merge fallback (RLF-97 gap): GitHub's native auto-merge is
    // unavailable on repos without required checks, so merge the verified-
    // mergeable PR here. Best-effort: a failure is logged and we still
    // advance to done — the PR was confirmed mergeable, and a human/native
    // auto-merge can finish it. Omitted dep ≡ fallback disabled.
    let merged = false;
    if (this.deps.mergePr) {
      merged = await this.deps.mergePr(prUrl);
    }
    this.deps.onLog(
      merged
        ? `  ${issue.identifier}: PR ${prUrl} merged — moving to done`
        : `  ${issue.identifier}: PR ${prUrl} mergeable — moving to done`,
      "green",
    );

    // The PR is healthy again — drop any recovery record now, so even if the
    // setDone write below fails and we leave the actor in `awaiting-ci`, the
    // board does not keep showing a now-green PR as failing.
    await this.deps.director.dispatch(this.deps.flowRef(issue), { type: "RECOVERY_CLEARED" });

    if (this.opts.setDone) {
      try {
        await this.deps.applyIndicator(issue, this.opts.setDone);
        this.deps.onLog(`  ${issue.identifier}: setDone applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setDone failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
        emitCapture(this.deps.bus, "agent_indicator_failed", {
          indicator: "setDone",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
        // Leave the actor in `awaiting-ci` (recovery already cleared) so the
        // next scan retries the advance.
        return;
      }
      if (this.opts.setInProgress) {
        try {
          await this.deps.removeIndicator(issue, this.opts.setInProgress);
          this.deps.onLog(`  ${issue.identifier}: clearInProgress applied`, "gray");
        } catch {
          // non-fatal — label cleanup failure doesn't affect the task outcome
        }
      }
    }

    await this.deps.director.dispatch(this.deps.flowRef(issue), { type: "PR_PASSED" });
    this.deps.director.disposeIfDone(issue.id);

    if (this.opts.postComments !== false) {
      try {
        await this.deps.postComment(
          issue,
          buildRalphyComment({
            type: "verified",
            action: merged ? "merged PR" : "verified PR mergeable",
            body: merged
              ? `Merged this PR (${prUrl}) (CI green, no conflicts) — moving to done.`
              : `Verified this PR (${prUrl}) is mergeable (CI green, no conflicts) — moving to done.`,
            fields: { pr: extractPrNumber(prUrl) ?? prUrl },
          }),
        );
      } catch (err) {
        this.deps.onLog(
          `! Linear done comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
  }

  /** Post any due iteration-milestone progress comments. */
  async reportProgress(workers: readonly ActiveWorker[]): Promise<void> {
    const everyN = this.opts.commentEveryIterations ?? 0;
    if (everyN <= 0 || this.opts.postComments === false || !this.deps.getIterationCount) {
      return;
    }
    for (const w of workers) {
      let count: number;
      try {
        count = await this.deps.getIterationCount(w.changeName);
      } catch (err) {
        this.deps.onLog(
          `! iteration count read failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      if (count < everyN) continue;
      const currMilestone = Math.floor(count / everyN);
      const lastMilestone = Math.floor(w.lastReportedIteration / everyN);
      if (currMilestone <= lastMilestone) continue;
      try {
        await this.deps.postComment(
          w.issue,
          buildRalphyComment({
            type: "progress",
            action: `progress update — iteration ${count}`,
            body: `Iteration ${count} on \`${w.changeName}\``,
            fields: { change: w.changeName, iter: count },
          }),
        );
        w.lastReportedIteration = count;
        this.deps.onLog(
          `  ${w.issueIdentifier}: posted progress comment (iteration ${count})`,
          "gray",
        );
      } catch (err) {
        this.deps.onLog(
          `! Linear progress comment failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }
  }

  /** Refresh the tasks comment for every active worker whose synced
   *  artifacts have changed since the last sync. Runs every poll (independent
   *  of the progress-comment cadence) so the tasks list reflects each
   *  checked-off item promptly — including mid-iteration ticks, which the
   *  fingerprint gate catches but the legacy iteration-count gate did not.
   *  Best-effort: failures log a yellow warning and leave the stored marker
   *  unchanged so the next poll retries. */
  async syncWorkerTasks(workers: readonly ActiveWorker[]): Promise<void> {
    if (!this.deps.syncTasks || !this.deps.getIterationCount) return;
    for (const w of workers) {
      if (this.deps.getTasksFingerprint) {
        // Preferred path: gate on artifact content so mid-iteration ticks
        // reach Linear at poll cadence.
        let fingerprint: string | null;
        try {
          fingerprint = await this.deps.getTasksFingerprint(w.changeName);
        } catch (err) {
          this.deps.onLog(
            `! tasks fingerprint read failed for ${w.issueIdentifier}: ${(err as Error).message}`,
            "yellow",
          );
          continue;
        }
        // No artifacts on disk yet, or nothing changed since the last sync.
        if (fingerprint === null || fingerprint === w.lastSyncedTasksFingerprint) {
          continue;
        }
        let iteration: number;
        try {
          iteration = await this.deps.getIterationCount(w.changeName);
        } catch (err) {
          this.deps.onLog(
            `! iteration count read failed for ${w.issueIdentifier}: ${(err as Error).message}`,
            "yellow",
          );
          continue;
        }
        try {
          await this.deps.syncTasks(w, iteration);
          // Only advance the marker after a successful sync, so a throw
          // leaves the fingerprint stale and the next poll retries.
          w.lastSyncedTasksFingerprint = fingerprint;
        } catch (err) {
          this.deps.onLog(
            `! sync-tasks (poll) failed for ${w.issueIdentifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
        continue;
      }

      // Legacy fallback: gate on the iteration counter when the fingerprint
      // dep is not wired (preserves prior behavior for those callers).
      let count: number;
      try {
        count = await this.deps.getIterationCount(w.changeName);
      } catch (err) {
        this.deps.onLog(
          `! iteration count read failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      if (count === w.lastSyncedIteration) continue;
      try {
        await this.deps.syncTasks(w, count);
        w.lastSyncedIteration = count;
      } catch (err) {
        this.deps.onLog(
          `! sync-tasks (poll) failed for ${w.issueIdentifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
  }
}
