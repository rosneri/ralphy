/**
 * RFC #402 — the worker lifecycle: prepare → spawn → exit → finalize. Owns
 * the active-worker set, the pending-prepare set, the concurrency fill loop,
 * the ticket counter, and the {@link WorkerPool.whenSettled} test barrier.
 * The queue itself stays with the shell — the pool pulls entries through the
 * `dequeue` port and hands restart re-queues back through `requeueFront`.
 */
import type { SetIndicator } from "@ralphy/types";
import type { IssueTrackerProvider, TrackedIssue } from "@ralphy/tracker";
import type { Bus } from "@ralphy/events";
import type { FlowAssignment, FlowDirector, FlowId, FlowRef } from "@ralphy/core/machines";
import { buildRalphyComment, isStartedComment } from "@ralphy/comms";
import { NO_CHANGES_EXIT } from "../../agent/post-task";
import {
  defaultPriorityFor,
  type MentionTrigger,
  type QueueEntry,
  type QueueTrigger,
} from "../../queue/queue-order";
import type { ActiveWorker } from "../types";
import { emitCapture } from "./telemetry";

/** Spawn shape — same as before. */
export interface WorkerHandle {
  exited: Promise<number>;
  kill: () => void;
}

/** Result of a `prepare` step. The wire layer is responsible for the side
 *  effects (scaffold, worktree create-or-resume, fix-task prepend, state
 *  reactivation) — the pool only sees the change name back. */
export interface PrepareResult {
  changeName: string;
  /** Optional: PR URL the spawn should reference (used for conflict-fix runs). */
  prUrl?: string;
  /** Working directory the worker runs in (the worktree when useWorktree is
   *  on). Carried onto the ActiveWorker so post-exit syncTasks flushes can
   *  resolve change artifacts after the wire layer has released its
   *  per-change maps. */
  cwd?: string;
}

/** Number of consecutive macrotask hops {@link WorkerPool.whenSettled}
 *  must observe an empty in-flight set before it concludes the system is idle.
 *  A worker's finalization enrolls only after its exit promise resolves, and
 *  under load that resolve→enroll chain can span more than one macrotask hop;
 *  requiring several stable observations closes that window without ever
 *  hanging on a still-running worker. Test-only barrier. */
const WHEN_SETTLED_STABLE_HOPS = 3;

/** Build the Linear comment for a finished worker. Split out to keep the
 *  outcomes (no-op done / quarantined failure / conflict-fix / ci-fix /
 *  deferred-awaiting / genuinely-done) as a flat branch rather than nested
 *  ternaries.
 *
 *  `reachedDone` is the flow actor's post-exit state — `true` only when the
 *  machine actually transitioned to `done`. When a PR is open and recovery is
 *  enabled the actor rests in `awaiting-ci` instead (the watcher owns the
 *  move to done once the PR is genuinely mergeable), so the comment must NOT
 *  claim "completed work" — it reports the real, awaiting state instead. This
 *  is the single guard that stops a fix/review iteration from announcing
 *  completion while the PR is still draft, red, unapproved, or unmerged. */
export function completionCommentBody(args: {
  noChanges: boolean;
  ok: boolean;
  trigger: QueueTrigger;
  changeName: string;
  code: number;
  /** Flow actor reached the terminal `done` state after this exit. */
  reachedDone: boolean;
}): string {
  const { noChanges, ok, trigger, changeName, code, reachedDone } = args;
  if (noChanges) {
    return buildRalphyComment({
      type: "completed-noop",
      action: "completed — no code changes",
      body:
        `Completed all tasks for this issue but produced no code changes — the requested ` +
        `work appears to already be present on the base branch (or was a no-op). No PR was ` +
        `opened. Change: \`${changeName}\`\n\n` +
        `Marking this done; please verify the work is genuinely in place. If it is not, ` +
        `reopen the issue with more specifics.`,
      fields: { change: changeName },
    });
  }
  if (!ok) {
    return buildRalphyComment({
      type: "exited",
      action: `exited with code ${code}`,
      body:
        `This issue has been quarantined and will not be auto-resumed on the next poll. ` +
        `Inspect the worktree at \`~/.ralph/<project>/worktrees/${changeName}\`, fix the ` +
        `underlying failure, then remove the error marker on this Linear issue (or run ` +
        `\`ralph clean --name ${changeName}\`) to clear the quarantine. Change: \`${changeName}\``,
      fields: { change: changeName, code },
    });
  }
  if (trigger === "conflict-fix") {
    return buildRalphyComment({
      type: "conflicts-resolved",
      action: "resolved merge conflicts",
      body: `Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  if (trigger === "ci-fix") {
    // A ci-fix iteration pushed a fix but has NOT re-verified CI — the watcher
    // re-checks the PR on the next poll. Announcing "completed work" here is
    // what made a still-red PR look done; report the honest in-flight state.
    return buildRalphyComment({
      type: "ci-fix-pushed",
      action: "pushed a CI fix",
      body:
        `Pushed a fix for the failing CI on this PR — re-checking the checks on the ` +
        `next poll before marking this done. Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  if (!reachedDone) {
    // PR is open and recovery is enabled, so the ticket rests in `awaiting-ci`
    // — the watcher advances it to done only once the PR is genuinely mergeable
    // (non-draft, approved, CI-green, no conflicts). This is NOT "completed
    // work": the work is pushed but the PR is not ready yet.
    const isReview = trigger === "review";
    return buildRalphyComment({
      type: "awaiting-ci",
      action: isReview ? "addressed review feedback" : "opened a PR",
      body:
        (isReview
          ? `Pushed changes for the review feedback to this PR. `
          : `Finished the work and opened a PR. `) +
        `Awaiting CI, review, and a clean merge state before marking this done. ` +
        `Change: \`${changeName}\``,
      fields: { change: changeName },
    });
  }
  return buildRalphyComment({
    type: "completed",
    action: "completed work",
    body: `Change: \`${changeName}\``,
    fields: { change: changeName },
  });
}

function triggerToFlowId(trigger: QueueTrigger): FlowId {
  if (trigger === "conflict-fix") return "conflict-fix";
  if (trigger === "ci-fix") return "ci-fix";
  if (trigger === "review") return "review-followup";
  return "implement";
}

export interface WorkerPoolDeps {
  prepare: (issue: TrackedIssue) => Promise<PrepareResult>;
  prepareTaskForTrigger?:
    | ((
        issue: TrackedIssue,
        changeName: string,
        trigger: QueueTrigger,
        mention?: MentionTrigger,
      ) => Promise<void>)
    | undefined;
  spawnWorker: (changeName: string, issue: TrackedIssue, trigger: QueueTrigger) => WorkerHandle;
  applyIndicator: IssueTrackerProvider["applyIndicator"];
  removeIndicator: IssueTrackerProvider["removeIndicator"];
  postComment: IssueTrackerProvider["postComment"];
  fetchComments: IssueTrackerProvider["fetchComments"];
  hasPrForChange?: ((changeName: string) => boolean) | undefined;
  getIterationCount?: ((changeName: string) => Promise<number>) | undefined;
  syncTasks?: ((worker: ActiveWorker, iteration: number) => Promise<void>) | undefined;
  onLog: (text: string, color?: string) => void;
  onWorkersChanged: () => void;
  bus: Bus;
  director: FlowDirector;
  flowRef: (issue: TrackedIssue) => FlowRef;
  /** Pull the next queue entry when a slot frees. The queue stays with the
   *  shell — ordering is its behavior. */
  dequeue: () => QueueEntry | undefined;
  /** Push a steering-restart resume back to the FRONT of the queue. */
  requeueFront: (entry: QueueEntry) => void;
}

export interface WorkerPoolOpts {
  concurrency: number;
  setInProgress?: SetIndicator | undefined;
  setDone?: SetIndicator | undefined;
  setError?: SetIndicator | undefined;
  postComments?: boolean | undefined;
  maxTickets?: number | undefined;
  createsPrs?: boolean | undefined;
  prRecovery?: { enabled: boolean } | undefined;
}

export class WorkerPool {
  private workersList: ActiveWorker[] = [];
  /** Issues whose prepare step is in flight (between dequeue and spawn). */
  private pendingIds = new Set<string>();
  /** Detached async continuations kicked off by the fill loop —
   *  `launch` (fire-and-forget) and each worker's exit continuation. Tracked
   *  so {@link whenSettled} can deterministically await them. */
  private inFlight = new Set<Promise<unknown>>();
  /** Total issues launched this process run — used to enforce maxTickets. */
  private ticketsStarted = 0;
  private stopped = false;

  constructor(
    private readonly deps: WorkerPoolDeps,
    private readonly opts: WorkerPoolOpts,
  ) {}

  get workers(): readonly ActiveWorker[] {
    return this.workersList;
  }
  get pendingIssueIds(): ReadonlySet<string> {
    return this.pendingIds;
  }
  get ticketsStartedCount(): number {
    return this.ticketsStarted;
  }

  /** Fill free slots from the queue (via the `dequeue` port). */
  fill(): void {
    if (this.stopped) return;
    while (this.workersList.length + this.pendingIds.size < this.opts.concurrency) {
      const next = this.deps.dequeue();
      if (!next) break;
      this.pendingIds.add(next.issue.id);
      this.track(this.launch(next.issue, next.trigger, next.mention));
    }
  }

  /** Register a detached promise so {@link whenSettled} can await it, and
   *  auto-remove it once it settles. Returns the promise unchanged so call
   *  sites can keep their fire-and-forget shape. */
  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight.add(p);
    void p.finally(() => {
      this.inFlight.delete(p);
    });
    return p;
  }

  /**
   * Await every detached spawn/exit continuation kicked off by the poll
   * loop until none remain. Test-only seam: `fill` launches workers
   * (and worker exits run their finalization) as fire-and-forget promises,
   * so a caller that wants to assert on their side-effects needs a
   * deterministic barrier instead of a fixed `setTimeout`. Yields a
   * macrotask between drains so freshly-scheduled continuations (e.g. an
   * exit handler registered the instant a worker resolves) get a chance to
   * enroll before we conclude the system is idle. Never waits on a still
   * running worker — only the work that runs *after* it exits is tracked.
   *
   * A worker's finalization enrolls lazily: `handle.exited.then(...)` only
   * adds the finalize continuation to `inFlight` *after* the worker's exit
   * promise resolves. Between `resolve()` and that enrollment there is a
   * window where `inFlight` is transiently empty even though finalization
   * is imminent. Under CI load that resolve→`.then`→enroll chain can span
   * more than one macrotask hop, so a single empty observation is not a
   * reliable idle signal. We therefore require the set to be observed empty
   * across {@link WHEN_SETTLED_STABLE_HOPS} consecutive macrotask hops
   * before concluding the system is idle — any pending enrollment lands in
   * one of those hops, re-fills `inFlight`, and resets the counter so we
   * drain it. This barrier is test-only; the extra idle yields cost a few
   * macrotasks and production never calls it.
   */
  async whenSettled(): Promise<void> {
    let consecutiveEmpty = 0;
    for (let guard = 0; guard < 1000; guard++) {
      if (this.inFlight.size > 0) {
        await Promise.allSettled(this.inFlight);
        consecutiveEmpty = 0;
      }
      await new Promise<void>((r) => setTimeout(r, 0));
      if (this.inFlight.size === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= WHEN_SETTLED_STABLE_HOPS) return;
      } else {
        consecutiveEmpty = 0;
      }
    }
  }

  private async launch(
    issue: TrackedIssue,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ): Promise<void> {
    let prep: PrepareResult;
    try {
      prep = await this.deps.prepare(issue);
      if (
        (trigger === "conflict-fix" || trigger === "ci-fix" || trigger === "review") &&
        this.deps.prepareTaskForTrigger
      ) {
        await this.deps.prepareTaskForTrigger(issue, prep.changeName, trigger, mention);
      }
    } catch (err) {
      this.pendingIds.delete(issue.id);
      this.deps.onLog(
        `! prepare(${trigger}) failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      emitCapture(this.deps.bus, "agent_prepare_failed", {
        spawn_mode: trigger,
        issue_identifier: issue.identifier,
        error: (err as Error).message,
      });
      // Quarantine: prepare failure (most often a worktree creation
      // failure) is the only signal the user has that the issue can't be
      // picked up. Apply `setError` so the ticket is filtered out of the
      // todo bucket and the human can investigate.
      if (this.opts.setError) {
        try {
          await this.deps.applyIndicator(issue, this.opts.setError);
          this.deps.onLog(`  ${issue.identifier}: setError applied`, "gray");
        } catch (markErr) {
          this.deps.onLog(
            `! Linear setError failed for ${issue.identifier}: ${(markErr as Error).message}`,
            "yellow",
          );
        }
      }
      this.fill();
      return;
    }

    if (this.stopped) {
      this.pendingIds.delete(issue.id);
      return;
    }

    // Apply setInProgress BEFORE spawning so a same-second re-poll doesn't
    // see the issue as still-todo. Skip for resume (already in progress).
    // Conflict-fix and review modes also apply it so the issue moves out
    // of its prior status (done/conflicted) immediately on pickup.
    if (trigger !== "resume" && this.opts.setInProgress) {
      try {
        await this.deps.applyIndicator(issue, this.opts.setInProgress);
        this.deps.onLog(`  ${issue.identifier}: setInProgress applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setInProgress failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        emitCapture(this.deps.bus, "agent_indicator_failed", {
          indicator: "setInProgress",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
    }

    if (trigger === "review" && this.opts.postComments !== false) {
      const sourceTag = mention
        ? mention.source === "github"
          ? " (GitHub @mention)"
          : mention.source === "github-review"
            ? " (GitHub code review)"
            : " (Linear @mention)"
        : "";
      try {
        await this.deps.postComment(
          issue,
          buildRalphyComment({
            type: "review-pickup",
            action: "picked up review comments",
            body: `Picked up new review comments${sourceTag}. Tracking change: \`${prep.changeName}\``,
            fields: { change: prep.changeName },
          }),
        );
      } catch (err) {
        this.deps.onLog(
          `! Linear review comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }

    // Post the "started" comment idempotently — only on fresh, and only if
    // we haven't already posted one (resume-detection via comment scan).
    if (trigger === "fresh" && this.opts.postComments !== false) {
      let alreadyPosted = false;
      try {
        const comments = await this.deps.fetchComments(issue.id);
        alreadyPosted = comments.some((c) => isStartedComment(c.body));
      } catch (err) {
        this.deps.onLog(
          `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
      if (!alreadyPosted) {
        try {
          await this.deps.postComment(
            issue,
            buildRalphyComment({
              type: "started",
              action: "started working",
              body: `Tracking change: \`${prep.changeName}\``,
              fields: { change: prep.changeName },
            }),
          );
          this.deps.onLog(`  ${issue.identifier}: posted "started" comment`, "gray");
        } catch (err) {
          this.deps.onLog(
            `! Linear comment failed for ${issue.identifier}: ${(err as Error).message}`,
            "red",
          );
        }
      }
    }

    this.deps.onLog(
      `▶ ${issue.identifier} → ${prep.changeName} (${trigger})`,
      trigger === "conflict-fix" ? "yellow" : "cyan",
    );
    const handle = this.deps.spawnWorker(prep.changeName, issue, trigger);
    const worker: ActiveWorker = {
      changeName: prep.changeName,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issue,
      trigger,
      ...(prep.cwd ? { cwd: prep.cwd } : {}),
      kill: handle.kill,
      lastReportedIteration: 0,
      lastSyncedIteration: 0,
      lastSyncedTasksFingerprint: null,
      restarting: false,
      reapedForAwaiting: false,
    };
    this.workersList.push(worker);
    this.pendingIds.delete(issue.id);

    // Notify the flow actor that a worker has been spawned so it can track
    // the handle. In-memory only — live handles cannot survive a persist.
    const flowWorker = {
      exited: handle.exited as Promise<number | null>,
      kill: (_signal?: "SIGTERM" | "SIGKILL") => handle.kill(),
    };
    const assignment: FlowAssignment = {
      flowId: triggerToFlowId(trigger),
      reason: `started via ${trigger}`,
      boost: "p2" as const,
    };
    this.deps.director.dispatchLoaded(issue.id, {
      type: "WORKER_SPAWNED",
      worker: flowWorker,
      assignment,
    });
    this.ticketsStarted += 1;
    const maxT = this.opts.maxTickets ?? 0;
    if (maxT > 0 && this.ticketsStarted >= maxT) {
      this.deps.onLog(
        `  ticket limit reached (${maxT}) — no new issues will be picked up`,
        "yellow",
      );
    }
    emitCapture(this.deps.bus, "agent_worker_spawned", {
      spawn_mode: trigger,
      issue_identifier: issue.identifier,
    });
    this.deps.onWorkersChanged();

    if (this.deps.syncTasks) {
      try {
        await this.deps.syncTasks(worker, 0);
      } catch (err) {
        this.deps.onLog(
          `! sync-tasks (launch) failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }

    // Track the exit *continuation* (not `handle.exited` itself) so
    // `whenSettled` waits for finalization to flush without hanging on a
    // still-running worker. Enrollment happens the instant the worker
    // resolves, inside the `.then` callback.
    void handle.exited.then((code) =>
      this.track(this.finalizeWorkerExit(worker, issue, prep, trigger, code)),
    );
  }

  /** The post-exit finalization continuation, extracted so it can be
   *  tracked by {@link whenSettled}. Mutates worker bookkeeping, finalizes
   *  the issue (or re-queues on restart/reap), and kicks the next spawn. */
  private async finalizeWorkerExit(
    worker: ActiveWorker,
    issue: TrackedIssue,
    prep: PrepareResult,
    trigger: QueueTrigger,
    code: number,
  ): Promise<void> {
    const idx = this.workersList.indexOf(worker);
    if (idx >= 0) this.workersList.splice(idx, 1);
    if (worker.restarting) {
      // Steering-driven restart — do not finalize the issue. Re-queue
      // the same issue as a resume so the next iteration picks up the
      // steering note we just appended.
      this.ticketsStarted = Math.max(0, this.ticketsStarted - 1);
      this.deps.requeueFront({
        issue,
        trigger: "resume",
        priority: defaultPriorityFor("resume"),
      });
      this.deps.onWorkersChanged();
      this.fill();
      return;
    }
    if (worker.reapedForAwaiting) {
      // Ticket flipped into awaiting-confirmation while this worker was
      // running. Do not finalize the issue (no setError/setDone). A
      // future poll will re-classify and resume after approval/revise.
      this.ticketsStarted = Math.max(0, this.ticketsStarted - 1);
      // Flush a final syncTasks pass so spec-attachments picks up the
      // proposal.md / design.md / tasks.md that the worker just wrote.
      // Without this, a planning-only worker (LIT-303 case) that
      // finishes inside iteration 0 leaves Linear with no design PDF —
      // the poll loop's `count === lastSyncedIteration` guard skips
      // every subsequent tick.
      if (this.deps.syncTasks) {
        let iteration = 0;
        if (this.deps.getIterationCount) {
          try {
            iteration = await this.deps.getIterationCount(worker.changeName);
          } catch {
            iteration = 0;
          }
        }
        try {
          await this.deps.syncTasks(worker, iteration);
        } catch (err) {
          this.deps.onLog(
            `! sync-tasks (awaiting-reap) failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
      }
      this.deps.onLog(`  ${issue.identifier}: worker reaped (awaiting human confirmation)`, "gray");
      this.deps.onWorkersChanged();
      this.fill();
      return;
    }
    const ok = code === 0 || code === NO_CHANGES_EXIT;
    this.deps.onLog(
      `${ok ? "✓" : "✗"} ${issue.identifier} → ${prep.changeName} exited (code ${code})`,
      ok ? "green" : "red",
    );
    emitCapture(this.deps.bus, "agent_worker_exited", {
      spawn_mode: trigger,
      issue_identifier: issue.identifier,
      exit_code: code,
      ok,
    });
    await this.notifyExited(issue, prep.changeName, code, trigger, worker.cwd);
    this.deps.onWorkersChanged();
    this.fill();
  }

  /** Kill the active worker for `changeName` and re-queue the same issue
   *  as a `resume` so steering applied between iterations takes effect
   *  immediately. Returns `false` if the pool is stopped or no active
   *  worker matches. */
  restartWorker(changeName: string): boolean {
    if (this.stopped) return false;
    const worker = this.workersList.find((w) => w.changeName === changeName);
    if (!worker) return false;
    if (worker.restarting) return true;
    worker.restarting = true;
    emitCapture(this.deps.bus, "agent_worker_restarted", {
      change_name: changeName,
      reason: "steering",
    });
    try {
      worker.kill();
    } catch {
      /* ignore */
    }
    return true;
  }

  /** Kill the active worker for `changeName` because the ticket has
   *  flipped into `awaiting-confirmation`. The exit handler skips
   *  finalization (no setDone/setError) and does NOT re-queue — a
   *  future poll resumes the ticket once the gate clears. Returns
   *  `true` if a matching active worker was found and reaped. */
  reapForAwaiting(changeName: string): boolean {
    if (this.stopped) return false;
    const worker = this.workersList.find((w) => w.changeName === changeName);
    if (!worker) return false;
    if (worker.reapedForAwaiting) return true;
    worker.reapedForAwaiting = true;
    emitCapture(this.deps.bus, "agent_worker_reaped_for_awaiting", { change_name: changeName });
    // Notify the flow actor to preempt the current worker and transition to awaiting
    const awaitingAssignment: FlowAssignment = {
      flowId: "confirmation",
      reason: "awaiting human confirmation",
      boost: "p2" as const,
    };
    this.deps.director.dispatchLoaded(worker.issueId, {
      type: "PREEMPT",
      newAssignment: awaitingAssignment,
    });
    try {
      worker.kill();
    } catch {
      /* ignore */
    }
    return true;
  }

  /** True when there is an active worker reaped (or being reaped) for
   *  awaiting-confirmation. Used by the wire layer to suppress PR
   *  creation in the post-task block of that worker's exit handler. */
  isAwaitingConfirmation(changeName: string): boolean {
    const w = this.workersList.find((w) => w.changeName === changeName);
    return w ? w.reapedForAwaiting : false;
  }

  private async notifyExited(
    issue: TrackedIssue,
    changeName: string,
    code: number,
    trigger: QueueTrigger,
    workerCwd?: string,
  ): Promise<void> {
    // NO_CHANGES_EXIT (no-op: branch only ever touched meta files, work already
    // on base) is finalized as a success — done with an honest comment — not a
    // quarantined failure. Treat it like `ok` for task sync and finalization.
    const noChanges = code === NO_CHANGES_EXIT;
    const ok = code === 0 || noChanges;

    // RLF-97: when a normal worker opens a PR and recovery is enabled, the
    // ticket is NOT done yet — it rests in-review and the watcher advances it
    // to done once the PR is mergeable. Defer `setDone` to the watcher and route
    // the actor to `awaiting-ci` (PR_OPENED) instead of `done` (WORKER_SUCCEEDED).
    // Recovery-trigger exits and the recovery-off / no-PR cases keep the
    // immediate-done behavior. `conflict-fix` / `ci-fix` successes route to
    // `awaiting-ci` via the machine's own WORKER_SUCCEEDED transition.
    const isRecoveryTrigger = trigger === "conflict-fix" || trigger === "ci-fix";
    const prOpened = this.deps.hasPrForChange?.(changeName) ?? false;
    // Defer only for PR-producing runs (`createsPrs`). A non-PR workflow keeps
    // the historical immediate-Done contract even if a stray PR was discovered
    // for the branch; `createsPrs && !prOpened` (no-op / no-commits finalize,
    // exit 70/71) also stays immediate-Done.
    const deferDone =
      ok &&
      !isRecoveryTrigger &&
      !!this.opts.createsPrs &&
      prOpened &&
      !!this.opts.prRecovery?.enabled;

    // Dispatch to flow actor based on exit code. A fix-trigger success also
    // clears the session's notification stamps inside the machine, re-arming
    // the gh-driven scan's comment dedup for the next genuine red.
    const exitView = await this.deps.director.dispatch(this.deps.flowRef(issue), {
      type: !ok ? "WORKER_FAILED" : deferDone ? "PR_OPENED" : "WORKER_SUCCEEDED",
    });
    const exitActorState = exitView.value;
    this.deps.director.disposeIfDone(issue.id);
    if (this.deps.syncTasks && ok) {
      const synthetic: ActiveWorker = {
        changeName,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issue,
        trigger,
        ...(workerCwd ? { cwd: workerCwd } : {}),
        kill: () => {},
        lastReportedIteration: 0,
        lastSyncedIteration: 0,
        lastSyncedTasksFingerprint: null,
        restarting: false,
        reapedForAwaiting: false,
      };
      try {
        let iteration = 0;
        if (this.deps.getIterationCount) {
          try {
            iteration = await this.deps.getIterationCount(changeName);
          } catch {
            iteration = 0;
          }
        }
        await this.deps.syncTasks(synthetic, iteration);
      } catch (err) {
        this.deps.onLog(
          `! sync-tasks (done) failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    if (this.opts.postComments !== false) {
      const body = completionCommentBody({
        noChanges,
        ok,
        trigger,
        changeName,
        code,
        reachedDone: exitActorState === "done",
      });
      try {
        await this.deps.postComment(issue, body);
        this.deps.onLog(`  ${issue.identifier}: posted completion comment`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }

    if (ok) {
      // Conflict-fix / ci-fix success: the worker iteration drove the re-fix;
      // the machine's WORKER_SUCCEEDED transition already cleared the
      // notification stamps, re-arming the gh-driven scan, so there is
      // nothing left to do here.
      if (trigger === "conflict-fix" || trigger === "ci-fix") {
        // handled by the flow machine
      } else if (deferDone) {
        // PR open + recovery enabled: the ticket rests in-review. The watcher
        // applies setDone (and clears in-progress) once the PR is mergeable, so
        // we leave both labels untouched here.
        this.deps.onLog(
          `  ${issue.identifier}: PR open — deferring setDone to the PR-recovery watcher`,
          "gray",
        );
      } else if (this.opts.setDone) {
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
        }
        // Remove the in-progress label now that the task is done.
        if (this.opts.setInProgress) {
          try {
            await this.deps.removeIndicator(issue, this.opts.setInProgress);
            this.deps.onLog(`  ${issue.identifier}: clearInProgress applied`, "gray");
          } catch {
            // non-fatal — label cleanup failure doesn't affect the task outcome
          }
        }
      }
    } else if (this.opts.setError) {
      try {
        await this.deps.applyIndicator(issue, this.opts.setError);
        this.deps.onLog(`  ${issue.identifier}: setError applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setError failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
        emitCapture(this.deps.bus, "agent_indicator_failed", {
          indicator: "setError",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
      // Remove the in-progress label now that the task has errored.
      if (this.opts.setInProgress) {
        try {
          await this.deps.removeIndicator(issue, this.opts.setInProgress);
          this.deps.onLog(`  ${issue.identifier}: clearInProgress applied`, "gray");
        } catch {
          // non-fatal
        }
      }
    }
  }

  /** Stop accepting new work and kill every active worker. */
  stop(): void {
    this.stopped = true;
    for (const w of this.workersList) {
      try {
        w.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
