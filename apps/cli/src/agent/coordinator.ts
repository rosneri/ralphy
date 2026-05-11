import type { SetIndicator } from "@ralphy/types";
import type { LinearIssue } from "./linear";
import { capture } from "@ralphy/telemetry";

/** Spawn shape — same as before. */
interface WorkerHandle {
  exited: Promise<number>;
  kill: () => void;
}

/** Result of a `prepare` step. The wire layer is responsible for the side
 *  effects (scaffold, worktree create-or-resume, fix-task prepend, state
 *  reactivation) — the coordinator only sees the change name back. */
export interface PrepareResult {
  changeName: string;
  /** Optional: PR URL the spawn should reference (used for conflict-fix runs). */
  prUrl?: string;
}

export type SpawnMode = "fresh" | "resume" | "conflict-fix" | "review";

export interface CoordinatorDeps {
  /** Issues to pick up. Empty array if `getTodo` isn't configured. */
  fetchTodo: () => Promise<LinearIssue[]>;
  /** Issues to resume after restart. Empty array if `getInProgress` isn't configured. */
  fetchInProgress: () => Promise<LinearIssue[]>;
  /** Issues already labeled conflicted (re-fix). Empty array if not configured. */
  fetchConflicted: () => Promise<LinearIssue[]>;
  /** Done issues flagged for review follow-up (new reviewer comments).
   *  Empty array if `getReview` isn't configured. */
  fetchReview: () => Promise<LinearIssue[]>;
  /** Issues with `setDone` applied that ralph should scan for PR conflicts.
   *  Empty array if conflict-scan isn't configured (no PR remote / no `setDone`). */
  fetchDoneCandidates: () => Promise<LinearIssue[]>;
  /**
   * Side-effect: scaffold (fresh), resume worktree (resume), or prepend
   * conflict-fix task + reactivate state (conflict-fix). Returns the
   * change name and (for conflict-fix) the PR URL.
   */
  prepare: (issue: LinearIssue, mode: SpawnMode) => Promise<PrepareResult>;
  /** Spawn the worker subprocess for `changeName`. */
  spawnWorker: (changeName: string, issue: LinearIssue) => WorkerHandle;
  /** Apply a SetIndicator (label add and/or status set) to the issue. */
  applyIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  /** Remove a SetIndicator's labels from the issue. Status removal is a no-op. */
  removeIndicator: (issue: LinearIssue, ind: SetIndicator) => Promise<void>;
  /** Post a comment to the Linear issue. */
  postComment: (issue: LinearIssue, body: string) => Promise<void>;
  /** Fetch existing Linear comments — used for "started" idempotency. */
  fetchComments: (issueId: string) => Promise<{ body: string }[]>;
  /** Check if a known PR has merge conflicts. Returns null if no PR is
   *  known for this issue (e.g. branch deleted, never created). */
  checkPrConflict: (issue: LinearIssue) => Promise<{ url: string; conflicting: boolean } | null>;
  onLog: (text: string, color?: string) => void;
  onWorkersChanged: () => void;
  /** Returns the current iteration count for an active worker (for
   *  periodic progress comments). */
  getIterationCount?: (changeName: string) => Promise<number>;
}

interface CoordinatorOptions {
  concurrency: number;
  setInProgress?: SetIndicator | undefined;
  setDone?: SetIndicator | undefined;
  setError?: SetIndicator | undefined;
  setConflicted?: SetIndicator | undefined;
  clearConflicted?: SetIndicator | undefined;
  clearReview?: SetIndicator | undefined;
  postComments?: boolean | undefined;
  commentEveryIterations?: number | undefined;
  /** Stop picking up new issues once this many have been started this run (0 = unlimited). */
  maxTickets?: number | undefined;
}

interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  issue: LinearIssue;
  mode: SpawnMode;
  kill: () => void;
  /** Highest iteration count we've already posted a progress comment for. */
  lastReportedIteration: number;
}

export class AgentCoordinator {
  private workers: ActiveWorker[] = [];
  /** Issues whose prepare step is in flight (between dequeue and spawn). */
  private pendingIds = new Set<string>();
  /** Per-issue queue of pending dequeues, with the spawn mode they should use. */
  private queue: { issue: LinearIssue; mode: SpawnMode }[] = [];
  private stopped = false;
  /** Issues we've already detected as conflicted in this process — guards
   *  against re-posting the conflict comment every poll. Cleared once
   *  the worker exits successfully (clearConflicted is applied). */
  private conflictNotified = new Set<string>();
  /** Total issues launched this process run — used to enforce maxTickets. */
  private ticketsStarted = 0;

  constructor(
    private readonly deps: CoordinatorDeps,
    private readonly opts: CoordinatorOptions,
  ) {}

  get activeCount(): number {
    return this.workers.length;
  }
  get queuedCount(): number {
    return this.queue.length;
  }
  get activeWorkers(): readonly ActiveWorker[] {
    return this.workers;
  }
  /** How many issues have been started this process run. */
  get ticketsStartedCount(): number {
    return this.ticketsStarted;
  }

  async init(): Promise<void> {
    // No-op — coordinator state is fully derived from Linear at poll time.
  }

  /**
   * One poll cycle:
   *  1. Fetch todo + in-progress + conflicted issues from Linear.
   *  2. Enqueue ones we aren't already handling, with the right spawn mode.
   *  3. Sort the queue by priority and spawn up to `concurrency`.
   *  4. Scan `setDone` PRs for merge conflicts (independent path).
   *  5. Post any due progress comments.
   *
   *  Returns counts for status display.
   */
  async pollOnce(): Promise<{ found: number; added: number }> {
    if (this.stopped) return { found: 0, added: 0 };

    let todo: LinearIssue[] = [];
    let inProgress: LinearIssue[] = [];
    let conflicted: LinearIssue[] = [];
    let review: LinearIssue[] = [];
    try {
      [todo, inProgress, conflicted, review] = await Promise.all([
        this.deps.fetchTodo(),
        this.deps.fetchInProgress(),
        this.deps.fetchConflicted(),
        this.deps.fetchReview(),
      ]);
    } catch (err) {
      this.deps.onLog(`! Linear poll failed: ${(err as Error).message}`, "red");
      capture("agent_linear_poll_failed", { error: (err as Error).message });
      return { found: 0, added: 0 };
    }

    if (todo.length + inProgress.length + conflicted.length + review.length > 0) {
      this.deps.onLog(
        `  poll: ${todo.length} todo, ${inProgress.length} in-progress, ${conflicted.length} conflicted, ${review.length} review`,
        "gray",
      );
    }

    const queuedIds = new Set(this.queue.map((q) => q.issue.id));
    const activeIds = new Set(this.workers.map((w) => w.issueId));
    const eligible = (id: string): boolean =>
      !queuedIds.has(id) && !activeIds.has(id) && !this.pendingIds.has(id);

    const maxT = this.opts.maxTickets ?? 0;
    /** Returns true when no more issues should be enqueued this run. */
    const atTicketLimit = (): boolean => {
      if (maxT === 0) return false;
      const inFlight =
        this.ticketsStarted + this.queue.length + this.workers.length + this.pendingIds.size;
      return inFlight >= maxT;
    };

    let added = 0;

    // 1. In-progress issues take precedence on restart — re-attach first
    //    so concurrency budget is honored.
    for (const issue of inProgress) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      this.queue.push({ issue, mode: "resume" });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (resume)`, "gray");
    }

    // 2. Conflicted issues: re-fix runs.
    for (const issue of conflicted) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      this.queue.push({ issue, mode: "conflict-fix" });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (conflict-fix)`, "gray");
    }

    // 3. Review follow-up: done issues with new reviewer comments.
    for (const issue of review) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      this.queue.push({ issue, mode: "review" });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (review)`, "gray");
    }

    // 4. Fresh todo.
    for (const issue of todo) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      this.queue.push({ issue, mode: "fresh" });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (fresh)`, "gray");
    }

    if (added > 0) {
      // Stable sort by priority (1=Urgent first; 0=No-priority last). Mode
      // preference is preserved when priority ties: resume < conflict-fix
      // < fresh, because resumes shouldn't wait behind a fresh queue.
      const modeRank: Record<SpawnMode, number> = {
        resume: 0,
        "conflict-fix": 1,
        review: 2,
        fresh: 3,
      };
      this.queue.sort((a, b) => {
        const pa = a.issue.priority === 0 ? Infinity : a.issue.priority;
        const pb = b.issue.priority === 0 ? Infinity : b.issue.priority;
        if (pa !== pb) return pa - pb;
        return modeRank[a.mode] - modeRank[b.mode];
      });
    }

    this.spawnNext();
    await this.scanDoneForConflicts();
    await this.reportProgress();

    const found = todo.length + inProgress.length + conflicted.length + review.length;
    return { found, added };
  }

  /** Returns true if all `blockedByIds` are not present in `inProgress`/
   *  `todo` view — i.e. they're either completed or external. The Linear
   *  fetch already filters out blockers in completed/cancelled states, so
   *  any remaining blocker is genuinely open. */
  private dependenciesResolved(issue: LinearIssue): boolean {
    if (issue.blockedByIds.length === 0) return true;
    const openIds = new Set([
      ...this.queue.map((q) => q.issue.id),
      ...this.workers.map((w) => w.issueId),
    ]);
    const blocker = issue.blockedByIds.find((bid) => openIds.has(bid));
    if (blocker !== undefined) {
      this.deps.onLog(
        `  ⏸ ${issue.identifier} skipped — blocked by unresolved dependency`,
        "yellow",
      );
      return false;
    }
    // Blockers that aren't in our open view: trust Linear's `blocked_by`
    // pruning (only unresolved blockers are returned). They might still be
    // genuinely open elsewhere — log and skip.
    this.deps.onLog(`  ⏸ ${issue.identifier} skipped — blocked by unresolved dependency`, "yellow");
    return false;
  }

  private async reportProgress(): Promise<void> {
    const everyN = this.opts.commentEveryIterations ?? 0;
    if (everyN <= 0 || this.opts.postComments === false || !this.deps.getIterationCount) {
      return;
    }
    for (const w of this.workers) {
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
          `🔄 Ralph progress update: iteration ${count} on \`${w.changeName}\``,
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

  /**
   * For every issue we believe is "done" but we tracked a PR for, check
   * whether the PR has merge conflicts. If yes, apply `setConflicted`,
   * post a Linear comment (once per detection), and enqueue the issue
   * for a conflict-fix run.
   */
  private async scanDoneForConflicts(): Promise<void> {
    if (!this.opts.setConflicted) return; // can't mark conflicted → can't act
    let candidates: LinearIssue[] = [];
    try {
      candidates = await this.deps.fetchDoneCandidates();
    } catch (err) {
      this.deps.onLog(`! conflict scan fetch failed: ${(err as Error).message}`, "yellow");
      return;
    }
    if (candidates.length === 0) return;

    for (const issue of candidates) {
      if (this.workers.some((w) => w.issueId === issue.id)) continue;
      if (this.pendingIds.has(issue.id)) continue;
      if (this.queue.some((q) => q.issue.id === issue.id)) continue;
      let pr: { url: string; conflicting: boolean } | null;
      try {
        pr = await this.deps.checkPrConflict(issue);
      } catch (err) {
        this.deps.onLog(
          `! PR conflict check failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        continue;
      }
      if (!pr || !pr.conflicting) continue;
      const alreadyNotified = this.conflictNotified.has(issue.id);
      if (alreadyNotified) continue;
      capture("agent_conflict_detected", { issue_identifier: issue.identifier });

      try {
        await this.deps.applyIndicator(issue, this.opts.setConflicted);
        this.deps.onLog(`  ${issue.identifier}: setConflicted applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setConflicted failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
        capture("agent_indicator_failed", {
          indicator: "setConflicted",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
        continue;
      }
      this.conflictNotified.add(issue.id);
      if (this.opts.postComments !== false) {
        try {
          await this.deps.postComment(
            issue,
            `⚠ Ralph detected merge conflicts on this PR (${pr.url}) — re-running to resolve`,
          );
          this.deps.onLog(`  ${issue.identifier}: posted conflict comment`, "gray");
        } catch (err) {
          this.deps.onLog(
            `! Linear conflict comment failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
      }
      this.queue.push({ issue, mode: "conflict-fix" });
    }

    this.spawnNext();
  }

  spawnNext(): void {
    if (this.stopped) return;
    while (
      this.workers.length + this.pendingIds.size < this.opts.concurrency &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()!;
      this.pendingIds.add(next.issue.id);
      void this.launchWorker(next.issue, next.mode);
    }
  }

  private async launchWorker(issue: LinearIssue, mode: SpawnMode): Promise<void> {
    let prep: PrepareResult;
    try {
      prep = await this.deps.prepare(issue, mode);
    } catch (err) {
      this.pendingIds.delete(issue.id);
      this.deps.onLog(
        `! prepare(${mode}) failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      capture("agent_prepare_failed", {
        spawn_mode: mode,
        issue_identifier: issue.identifier,
        error: (err as Error).message,
      });
      this.spawnNext();
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
    if (mode !== "resume" && this.opts.setInProgress) {
      try {
        await this.deps.applyIndicator(issue, this.opts.setInProgress);
        this.deps.onLog(`  ${issue.identifier}: setInProgress applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setInProgress failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        capture("agent_indicator_failed", {
          indicator: "setInProgress",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
    }

    // Review mode: remove the trigger label so the same comments don't
    // re-fire on the next poll. Best-effort.
    if (mode === "review" && this.opts.clearReview) {
      try {
        await this.deps.removeIndicator(issue, this.opts.clearReview);
        this.deps.onLog(`  ${issue.identifier}: clearReview applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear clearReview failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
        capture("agent_indicator_failed", {
          indicator: "clearReview",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
    }

    if (mode === "review" && this.opts.postComments !== false) {
      try {
        await this.deps.postComment(
          issue,
          `🔁 Ralph picked up new review comments. Tracking change: \`${prep.changeName}\``,
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
    if (mode === "fresh" && this.opts.postComments !== false) {
      let alreadyPosted = false;
      try {
        const comments = await this.deps.fetchComments(issue.id);
        alreadyPosted = comments.some((c) => c.body.startsWith("🤖 Ralph started working"));
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
            `🤖 Ralph started working on this issue. Tracking change: \`${prep.changeName}\``,
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
      `▶ ${issue.identifier} → ${prep.changeName} (${mode})`,
      mode === "conflict-fix" ? "yellow" : "cyan",
    );
    const handle = this.deps.spawnWorker(prep.changeName, issue);
    const worker: ActiveWorker = {
      changeName: prep.changeName,
      issueId: issue.id,
      issueIdentifier: issue.identifier,
      issue,
      mode,
      kill: handle.kill,
      lastReportedIteration: 0,
    };
    this.workers.push(worker);
    this.pendingIds.delete(issue.id);
    this.ticketsStarted += 1;
    const maxT = this.opts.maxTickets ?? 0;
    if (maxT > 0 && this.ticketsStarted >= maxT) {
      this.deps.onLog(
        `  ticket limit reached (${maxT}) — no new issues will be picked up`,
        "yellow",
      );
    }
    capture("agent_worker_spawned", {
      spawn_mode: mode,
      issue_identifier: issue.identifier,
    });
    this.deps.onWorkersChanged();

    void handle.exited.then(async (code) => {
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) this.workers.splice(idx, 1);
      const ok = code === 0;
      this.deps.onLog(
        `${ok ? "✓" : "✗"} ${issue.identifier} → ${prep.changeName} exited (code ${code})`,
        ok ? "green" : "red",
      );
      capture("agent_worker_exited", {
        spawn_mode: mode,
        issue_identifier: issue.identifier,
        exit_code: code,
        ok,
      });
      await this.notifyExited(issue, prep.changeName, code, mode);
      this.deps.onWorkersChanged();
      this.spawnNext();
    });
  }

  private async notifyExited(
    issue: LinearIssue,
    changeName: string,
    code: number,
    mode: SpawnMode,
  ): Promise<void> {
    const ok = code === 0;
    if (this.opts.postComments !== false) {
      const body = ok
        ? mode === "conflict-fix"
          ? `✅ Ralph resolved merge conflicts on this issue. Change: \`${changeName}\``
          : `✅ Ralph completed work on this issue. Change: \`${changeName}\``
        : `✗ Ralph exited with code ${code} on this issue. Change: \`${changeName}\`\n\n` +
          `This issue has been quarantined and will not be auto-resumed on the next poll. ` +
          `Inspect the worktree at \`~/.ralph/<project>/worktrees/${changeName}\`, fix the ` +
          `underlying failure, then remove the error marker on this Linear issue (or run ` +
          `\`ralph clean --name ${changeName}\`) to clear the quarantine.`;
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
      // Conflict-fix success: clear the conflicted marker, leave setDone alone.
      if (mode === "conflict-fix") {
        if (this.opts.clearConflicted) {
          try {
            await this.deps.removeIndicator(issue, this.opts.clearConflicted);
            this.deps.onLog(`  ${issue.identifier}: clearConflicted applied`, "gray");
          } catch (err) {
            this.deps.onLog(
              `! Linear clearConflicted failed for ${issue.identifier}: ${(err as Error).message}`,
              "red",
            );
            capture("agent_indicator_failed", {
              indicator: "clearConflicted",
              issue_identifier: issue.identifier,
              error: (err as Error).message,
            });
          }
        }
        this.conflictNotified.delete(issue.id);
      } else if (this.opts.setDone) {
        try {
          await this.deps.applyIndicator(issue, this.opts.setDone);
          this.deps.onLog(`  ${issue.identifier}: setDone applied`, "gray");
        } catch (err) {
          this.deps.onLog(
            `! Linear setDone failed for ${issue.identifier}: ${(err as Error).message}`,
            "red",
          );
          capture("agent_indicator_failed", {
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
        capture("agent_indicator_failed", {
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

  stop(): void {
    this.stopped = true;
    for (const w of this.workers) {
      try {
        w.kill();
      } catch {
        /* ignore */
      }
    }
  }
}
