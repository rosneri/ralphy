import type { GetIndicator, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { LinearIssue } from "./linear";
import { issueMatchesGetIndicator } from "./linear";
import { compareQueueEntries, type QueueEntry } from "../queue/queue-order";
import type { MentionTrigger, SpawnMode } from "../queue/queue-order";
import { capture as telemetryCapture } from "@ralphy/telemetry";
import type { Bus, EmitInput, RalphEvent } from "@ralphy/events";
import { createNoopBus } from "@ralphy/events";

/**
 * Stage 1: Emits to PostHog AND to the event bus side-by-side. The legacy
 * `capture(event, props)` call sites switch to `capture.call(this, ...)`
 * via a small helper so neither sink is missed.
 */
function emitCapture<T extends RalphEvent["type"]>(
  bus: Bus,
  event: T,
  properties?: Record<string, unknown>,
): void {
  telemetryCapture(event, properties);
  bus.emit({ type: event, ...properties } as Extract<EmitInput, { type: T }>);
}

export type { SpawnMode, MentionTrigger } from "../queue/queue-order";

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

/** Per-bucket counts surfaced by `pollOnce` for the dashboard / JSON
 *  output. `found` is the sum across buckets and `added` is how many
 *  the coordinator actually enqueued this tick (after eligibility,
 *  dependency, and ticket-cap checks). */
export interface PollBuckets {
  todo: number;
  inProgress: number;
  conflicted: number;
  review: number;
  mentions: number;
  /** In-progress issues whose OpenSpec phase is `awaiting-confirmation`. They
   *  are excluded from the resumable bucket — the coordinator never enqueues
   *  them and they do not consume `concurrency` slots. The poll loop still
   *  surfaces them in this count so the dashboard / JSON output can show
   *  how many tickets are gated awaiting human confirmation. */
  awaiting: number;
}
/** Per-status counts across the done-candidate PRs scanned this tick.
 *  Surfaced in the dashboard so operators can see at a glance how many
 *  shipped PRs are mergeable, blocked by merge conflicts, or red on CI. */
export interface PrStatusCounts {
  mergeable: number;
  conflicted: number;
  ciFailed: number;
}
export type PrStatus = "mergeable" | "conflicted" | "ci_failed" | "unknown";
export type Flow = "awaiting" | "working" | "conflict-fix" | "ci-fix" | "review";
export type PlanPhaseValue = "proposal" | "design" | "tasks" | "implement" | "done";
export interface PollResult {
  found: number;
  added: number;
  buckets: PollBuckets;
  prStatus: PrStatusCounts;
  /** Per-change lifecycle phase derived from on-disk artifacts. Empty when
   *  the poll did not derive any (e.g. baseline gate paused, or no in-flight
   *  workers). Additive — additional Stage-5 derivations will land here. */
  phase: Record<string, PlanPhaseValue>;
  /** Per-change activity flow — independent of `phase`. Empty when the poll
   *  did not derive any. */
  flow: Record<string, Flow>;
}
const emptyPrStatus = (): PrStatusCounts => ({ mergeable: 0, conflicted: 0, ciFailed: 0 });

/** Pull the PR number out of a GitHub pull URL, e.g.
 *  `https://github.com/owner/repo/pull/376` → `376`. Returns null when the
 *  URL doesn't match — callers render the full URL in that case. */
function extractPrNumber(url: string): string | null {
  const m = /\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
  return m ? (m[1] ?? null) : null;
}
const emptyPollResult = (): PollResult => ({
  found: 0,
  added: 0,
  buckets: { todo: 0, inProgress: 0, conflicted: 0, review: 0, mentions: 0, awaiting: 0 },
  prStatus: emptyPrStatus(),
  phase: {},
  flow: {},
});

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
  /** Done issues with new `@ralphy` mentions on Linear or their tracked
   *  GitHub PR. Empty array if mention scanning is disabled. */
  fetchMentions: () => Promise<{ issue: LinearIssue; trigger: MentionTrigger }[]>;
  /** Issues with `setDone` applied that ralph should scan for PR conflicts.
   *  Empty array if conflict-scan isn't configured (no PR remote / no `setDone`). */
  fetchDoneCandidates: () => Promise<LinearIssue[]>;
  /**
   * Side-effect: scaffold (fresh), resume worktree (resume), or prepend
   * conflict-fix / review task + reactivate state. Returns the change
   * name and (for conflict-fix) the PR URL. When `trigger` is supplied
   * (review mode + mention scan), wire uses the trigger body verbatim
   * as the task content instead of fetching all non-Ralph comments.
   */
  prepare: (
    issue: LinearIssue,
    mode: SpawnMode,
    trigger?: MentionTrigger,
  ) => Promise<PrepareResult>;
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
  /** Check the status of a known PR — mergeable, conflicted, or red on CI.
   *  Returns null if no PR is known for this issue (branch deleted, never
   *  created). `unknown` is used when GitHub hasn't computed mergeability
   *  yet or `gh` failed; the caller skips acting on it. */
  checkPrStatus: (issue: LinearIssue) => Promise<{ url: string; status: PrStatus } | null>;
  /** Returns true when the openspec change for this issue has already been
   *  archived locally (i.e. a directory matching
   *  `openspec/changes/archive/*-<changeName>/` exists). Used to detect
   *  finished-but-conflicted in-progress tickets so they can be promoted
   *  into the conflict-fix flow. Optional — when omitted, the conflict
   *  promotion check is a no-op. */
  isChangeArchivedForIssue?: (issue: LinearIssue) => Promise<boolean>;
  onLog: (text: string, color?: string) => void;
  /** Log lines that should be persisted to the on-disk agent log but not
   *  surfaced in the UI panel (e.g. the per-poll summary). Dropped silently
   *  when not provided. */
  onFileLog?: (text: string) => void;
  onWorkersChanged: () => void;
  /** Optional hook: classify which of the supplied in-progress issues are
   *  currently in the `awaiting-confirmation` OpenSpec phase. The coordinator
   *  uses the returned set to (a) split them out of the resumable bucket so
   *  they never consume a concurrency slot and (b) report the bucket count
   *  for the dashboard. Returning an empty set (or omitting the hook) keeps
   *  the legacy behaviour — every in-progress issue resumes. */
  classifyAwaitingConfirmation?: (issues: LinearIssue[]) => Promise<ReadonlySet<string>>;
  /** Returns the current iteration count for an active worker (for
   *  periodic progress comments). */
  getIterationCount?: (changeName: string) => Promise<number>;
  /** Optional hook: mirror tasks.md into the issue description. Invoked on
   *  worker launch, on each milestone (same cadence as progress comments),
   *  and on done-transition. Failures are swallowed by the impl. */
  syncTasks?: (worker: ActiveWorker, iteration: number) => Promise<void>;
  /** Optional hook: react to a steering note being appended to a change.
   *  The MCP `ralph_append_steering` tool triggers this so comment-sync
   *  can post a fresh steering comment and refresh the tasks comment on
   *  Linear. Failures are swallowed by the caller. */
  onSteeringAppended?: (changeName: string, message: string) => Promise<void>;
  /** Optional event bus to mirror telemetry/log events onto. Defaults to a
   *  no-op bus when omitted — Stage 1 wiring is purely additive, so existing
   *  callers don't have to thread it through. */
  bus?: Bus;
  /** Optional hook fired at the start of each poll cycle (before any Linear
   *  fetch). Wire uses this to reset its per-poll `PollContext` memo so
   *  duplicate `gh pr view` calls within the same poll share a single
   *  invocation. Synchronous to avoid sequencing concerns. */
  beforePoll?: () => void;
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
  /** When set, conflict-fix items whose issue matches this indicator are
   *  promoted to the head of the queue, ahead of Linear priority. */
  getAutoMerge?: GetIndicator | undefined;
}

export interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  issue: LinearIssue;
  mode: SpawnMode;
  kill: () => void;
  /** Highest iteration count we've already posted a progress comment for. */
  lastReportedIteration: number;
  /** Iteration count last passed to `syncTasks`. Lets the poll loop skip
   *  re-syncing when the worker hasn't ticked a new iteration. Initialized
   *  to 0 on spawn since the launch path syncs iteration 0 immediately. */
  lastSyncedIteration: number;
  /** Set by `restartWorker` so the exit handler skips notifyExited and
   *  re-queues the worker as a resume instead of finalizing the issue. */
  restarting: boolean;
  /** Set by `reapForAwaiting` when the coordinator kills the worker
   *  because the ticket has flipped into `awaiting-confirmation`. The
   *  exit handler skips notifyExited (no setError, no setDone) and does
   *  NOT re-queue — the ticket will be resumed on a future poll once the
   *  gate clears (approval or revise comment). */
  reapedForAwaiting: boolean;
}

/** Pause state set by the baseline gate when the project's base branch is broken.
 *  The coordinator skips picking up new work while this is set, but in-flight
 *  workers continue. The gate clears it once the trunk is green again. */
export interface PauseState {
  /** Linear ticket identifier (e.g. "RLF-99") that tracks the failing baseline. */
  issueIdentifier: string;
  /** Linear issue UUID — kept so the gate can refresh the same ticket. */
  issueId?: string;
  /** Failing command (used for the dashboard banner). */
  command: string;
  /** Fingerprint of the failure that caused the pause. */
  fingerprint: string;
  /** Epoch-ms when the pause was first set; renders the duration on the banner. */
  since: number;
}

export class AgentCoordinator {
  private workers: ActiveWorker[] = [];
  /** Issues whose prepare step is in flight (between dequeue and spawn). */
  private pendingIds = new Set<string>();
  /** Per-issue queue of pending dequeues, with the spawn mode they should use. */
  private queue: QueueEntry[] = [];
  private stopped = false;
  private paused: PauseState | null = null;
  /** Issues we've already detected as conflicted in this process — guards
   *  against re-posting the conflict comment every poll. Cleared once
   *  the worker exits successfully (clearConflicted is applied). */
  private conflictNotified = new Set<string>();
  /** Issue IDs we've already posted the "promoted to conflict-fix" comment
   *  for in this process run. Guards against double-posting if the next
   *  poll still sees the ticket in `getInProgress` (e.g. Linear hasn't
   *  yet propagated the label, or the label add failed). Cleared when the
   *  conflict-fix worker exits (clearConflicted applied). */
  private conflictPromoted = new Set<string>();
  /** Total issues launched this process run — used to enforce maxTickets. */
  private ticketsStarted = 0;

  private readonly bus: Bus;

  constructor(
    private readonly deps: CoordinatorDeps,
    private readonly opts: CoordinatorOptions,
  ) {
    this.bus = deps.bus ?? createNoopBus();
  }

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

  isPaused(): boolean {
    return this.paused !== null;
  }
  getPause(): PauseState | null {
    return this.paused;
  }
  setPaused(state: PauseState): void {
    this.paused = state;
  }
  clearPaused(): void {
    this.paused = null;
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
  async pollOnce(): Promise<PollResult> {
    if (this.stopped) return emptyPollResult();
    this.deps.beforePoll?.();

    let todo: LinearIssue[] = [];
    let inProgress: LinearIssue[] = [];
    let conflicted: LinearIssue[] = [];
    let review: LinearIssue[] = [];
    let mentions: { issue: LinearIssue; trigger: MentionTrigger }[] = [];
    try {
      [todo, inProgress, conflicted, review, mentions] = await Promise.all([
        this.deps.fetchTodo(),
        this.deps.fetchInProgress(),
        this.deps.fetchConflicted(),
        this.deps.fetchReview(),
        this.deps.fetchMentions(),
      ]);
    } catch (err) {
      this.deps.onLog(`! Linear poll failed: ${(err as Error).message}`, "red");
      emitCapture(this.bus, "agent_linear_poll_failed", { error: (err as Error).message });
      return emptyPollResult();
    }

    // Pull awaiting-confirmation tickets out of the resumable bucket so the
    // coordinator never enqueues them as `resume`. They stay surfaced via
    // `buckets.awaiting` so the dashboard can render the gated count.
    let awaiting: LinearIssue[] = [];
    if (this.deps.classifyAwaitingConfirmation && inProgress.length > 0) {
      try {
        const awaitingIds = await this.deps.classifyAwaitingConfirmation(inProgress);
        if (awaitingIds.size > 0) {
          awaiting = inProgress.filter((i) => awaitingIds.has(i.id));
          inProgress = inProgress.filter((i) => !awaitingIds.has(i.id));
        }
      } catch (err) {
        this.deps.onLog(
          `! awaiting-confirmation classify failed: ${(err as Error).message}`,
          "yellow",
        );
      }
    }

    if (
      todo.length +
        inProgress.length +
        conflicted.length +
        review.length +
        mentions.length +
        awaiting.length >
      0
    ) {
      this.deps.onFileLog?.(
        `  poll: ${todo.length} todo, ${inProgress.length} in-progress, ${conflicted.length} conflicted, ${review.length} review, ${mentions.length} mention, ${awaiting.length} awaiting`,
      );
    }

    const queuedIds = new Set(this.queue.map((q) => q.issue.id));
    const activeIds = new Set(this.workers.map((w) => w.issueId));
    const eligible = (id: string): boolean =>
      !queuedIds.has(id) && !activeIds.has(id) && !this.pendingIds.has(id);

    if (this.paused) {
      this.deps.onLog(
        `  paused — baseline broken (${this.paused.issueIdentifier}); skipping new pickups`,
        "yellow",
      );
      const buckets: PollBuckets = {
        todo: todo.length,
        inProgress: inProgress.length,
        conflicted: conflicted.length,
        review: review.length,
        mentions: mentions.length,
        awaiting: awaiting.length,
      };
      const found =
        buckets.todo +
        buckets.inProgress +
        buckets.conflicted +
        buckets.review +
        buckets.mentions +
        buckets.awaiting;
      return { found, added: 0, buckets, prStatus: emptyPrStatus(), phase: {}, flow: {} };
    }

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
    //    so concurrency budget is honored. Before queueing as resume,
    //    detect "finished but conflicting" tickets and route them into
    //    the conflict-fix flow by applying setConflicted.
    for (const issue of inProgress) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      if (await this.maybePromoteFinishedConflicted(issue)) continue;
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
      if (this.isAutoMergeUnblock(issue)) {
        this.deps.onLog(`  ↳ ${issue.identifier} queued (auto-merge unblock, prioritized)`, "cyan");
      } else {
        this.deps.onLog(`  ↳ ${issue.identifier} queued (conflict-fix)`, "gray");
      }
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

    // 3b. @ralphy mention triggers — Linear / GitHub comments newer than
    //     Ralph's last review-pickup ack. The trigger body becomes the task.
    for (const { issue, trigger } of mentions) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      this.queue.push({ issue, mode: "review", trigger });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(
        `  ↳ ${issue.identifier} queued (review via ${trigger.source} mention)`,
        "gray",
      );
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
      this.queue.sort(compareQueueEntries(this.opts.getAutoMerge));
    }

    this.spawnNext();
    const prStatus = await this.scanDoneForConflicts();
    await this.reportProgress();
    await this.syncWorkerTasks();

    const buckets: PollBuckets = {
      todo: todo.length,
      inProgress: inProgress.length,
      conflicted: conflicted.length,
      review: review.length,
      mentions: mentions.length,
      awaiting: awaiting.length,
    };
    const found =
      buckets.todo +
      buckets.inProgress +
      buckets.conflicted +
      buckets.review +
      buckets.mentions +
      buckets.awaiting;
    const flow: Record<string, Flow> = {};
    for (const w of this.workers) {
      if (w.mode === "conflict-fix") flow[w.changeName] = "conflict-fix";
      else if (w.mode === "review") flow[w.changeName] = "review";
      else flow[w.changeName] = "working";
    }
    return { found, added, buckets, prStatus, phase: {}, flow };
  }

  /**
   * Detect "finished but conflicting" in-progress tickets — the change is
   * archived locally (all tasks done, branch pushed), but the PR has merge
   * conflicts with main, so `setDone` never fires on merge and the ticket
   * sits in `getInProgress` forever. When detected, apply `setConflicted`
   * + post a one-line Linear comment so the next poll picks the ticket up
   * via `getConflicted` instead. Returns true when the ticket was promoted
   * (or is already promoted) and should be skipped from the in-progress
   * queue this poll.
   */
  private async maybePromoteFinishedConflicted(issue: LinearIssue): Promise<boolean> {
    const setConflicted = this.opts.setConflicted;
    if (!setConflicted) return false;
    if (!this.deps.isChangeArchivedForIssue) return false;

    // Already labeled conflicted on Linear → let getConflicted route it.
    if (this.issueHasIndicator(issue, setConflicted)) return true;

    let archived = false;
    try {
      archived = await this.deps.isChangeArchivedForIssue(issue);
    } catch (err) {
      this.deps.onLog(
        `! archive lookup failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return false;
    }
    if (!archived) return false;

    let pr: { url: string; status: PrStatus } | null;
    try {
      pr = await this.deps.checkPrStatus(issue);
    } catch (err) {
      this.deps.onLog(
        `! PR status check failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return false;
    }
    if (!pr || pr.status !== "conflicted") return false;

    try {
      await this.deps.applyIndicator(issue, setConflicted);
      this.deps.onLog(
        `  ${issue.identifier}: promoted to conflict-fix (PR ${pr.url} conflicting)`,
        "yellow",
      );
    } catch (err) {
      this.deps.onLog(
        `! Linear setConflicted (promotion) failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      emitCapture(this.bus, "agent_indicator_failed", {
        indicator: "setConflicted",
        issue_identifier: issue.identifier,
        error: (err as Error).message,
      });
      return false;
    }

    emitCapture(this.bus, "agent_conflict_promoted", {
      issue_identifier: issue.identifier,
      pr_url: pr.url,
    });

    if (!this.conflictPromoted.has(issue.id) && this.opts.postComments !== false) {
      const prNum = extractPrNumber(pr.url);
      const ref = prNum !== null ? `PR #${prNum}` : `PR ${pr.url}`;
      try {
        await this.deps.postComment(
          issue,
          `⚠️ ${ref} is conflicting with main — promoted to conflict-fix flow.`,
        );
        this.deps.onLog(`  ${issue.identifier}: posted conflict-promotion comment`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear conflict-promotion comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    this.conflictPromoted.add(issue.id);
    return true;
  }

  /** True when the issue's labels already include every label-marker the
   *  SetIndicator would add. Non-label markers (status, project, etc.) are
   *  ignored — the conflict-promotion check only cares about whether the
   *  conflict label is already present. */
  private issueHasIndicator(issue: LinearIssue, ind: SetIndicator): boolean {
    const labels = new Set(issue.labels.map((l) => l.toLowerCase()));
    const labelMarkers = markersOf(ind).filter((m) => m.type === "label");
    if (labelMarkers.length === 0) return false;
    return labelMarkers.every((m) => labels.has(m.value.toLowerCase()));
  }

  /** True when the issue carries the auto-merge indicator. Used to boost
   *  conflict-fix items ahead of every other queued mode/priority. */
  private isAutoMergeUnblock(issue: LinearIssue): boolean {
    return issueMatchesGetIndicator(issue, this.opts.getAutoMerge);
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

  /** Refresh the tasks comment for every active worker whose iteration
   *  count has advanced since the last sync. Runs every poll (independent
   *  of the progress-comment cadence) so the tasks list reflects each
   *  checked-off item promptly. Best-effort: failures log a yellow warning
   *  and leave `lastSyncedIteration` unchanged so the next poll retries. */
  private async syncWorkerTasks(): Promise<void> {
    if (!this.deps.syncTasks || !this.deps.getIterationCount) return;
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

  /**
   * For every issue we believe is "done" but we tracked a PR for, check
   * whether the PR has merge conflicts. If yes, apply `setConflicted`,
   * post a Linear comment (once per detection), and enqueue the issue
   * for a conflict-fix run.
   */
  private async scanDoneForConflicts(): Promise<PrStatusCounts> {
    const counts = emptyPrStatus();
    if (!this.opts.setConflicted) return counts; // can't mark conflicted → can't act
    let candidates: LinearIssue[] = [];
    try {
      candidates = await this.deps.fetchDoneCandidates();
    } catch (err) {
      this.deps.onLog(`! conflict scan fetch failed: ${(err as Error).message}`, "yellow");
      return counts;
    }
    if (candidates.length === 0) return counts;

    for (const issue of candidates) {
      if (this.workers.some((w) => w.issueId === issue.id)) continue;
      if (this.pendingIds.has(issue.id)) continue;
      if (this.queue.some((q) => q.issue.id === issue.id)) continue;
      let pr: { url: string; status: PrStatus } | null;
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
      if (pr.status === "mergeable") counts.mergeable += 1;
      else if (pr.status === "conflicted") counts.conflicted += 1;
      else if (pr.status === "ci_failed") counts.ciFailed += 1;
      if (pr.status !== "conflicted") continue;
      const alreadyNotified = this.conflictNotified.has(issue.id);
      if (alreadyNotified) continue;
      emitCapture(this.bus, "agent_conflict_detected", { issue_identifier: issue.identifier });

      try {
        await this.deps.applyIndicator(issue, this.opts.setConflicted);
        this.deps.onLog(`  ${issue.identifier}: setConflicted applied`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear setConflicted failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
        emitCapture(this.bus, "agent_indicator_failed", {
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
    return counts;
  }

  spawnNext(): void {
    if (this.stopped) return;
    while (
      this.workers.length + this.pendingIds.size < this.opts.concurrency &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()!;
      this.pendingIds.add(next.issue.id);
      void this.launchWorker(next.issue, next.mode, next.trigger);
    }
  }

  private async launchWorker(
    issue: LinearIssue,
    mode: SpawnMode,
    trigger?: MentionTrigger,
  ): Promise<void> {
    let prep: PrepareResult;
    try {
      prep = await this.deps.prepare(issue, mode, trigger);
    } catch (err) {
      this.pendingIds.delete(issue.id);
      this.deps.onLog(
        `! prepare(${mode}) failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      emitCapture(this.bus, "agent_prepare_failed", {
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
        emitCapture(this.bus, "agent_indicator_failed", {
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
        emitCapture(this.bus, "agent_indicator_failed", {
          indicator: "clearReview",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
    }

    if (mode === "review" && this.opts.postComments !== false) {
      const sourceTag = trigger
        ? trigger.source === "github"
          ? " (GitHub @mention)"
          : trigger.source === "github-review"
            ? " (GitHub code review)"
            : " (Linear @mention)"
        : "";
      try {
        await this.deps.postComment(
          issue,
          `🔁 Ralph picked up new review comments${sourceTag}. Tracking change: \`${prep.changeName}\``,
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
      lastSyncedIteration: 0,
      restarting: false,
      reapedForAwaiting: false,
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
    emitCapture(this.bus, "agent_worker_spawned", {
      spawn_mode: mode,
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

    void handle.exited.then(async (code) => {
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) this.workers.splice(idx, 1);
      if (worker.restarting) {
        // Steering-driven restart — do not finalize the issue. Re-queue
        // the same issue as a resume so the next iteration picks up the
        // steering note we just appended.
        this.ticketsStarted = Math.max(0, this.ticketsStarted - 1);
        this.queue.unshift({ issue, mode: "resume" });
        this.deps.onWorkersChanged();
        this.spawnNext();
        return;
      }
      if (worker.reapedForAwaiting) {
        // Ticket flipped into awaiting-confirmation while this worker was
        // running. Do not finalize the issue (no setError/setDone). A
        // future poll will re-classify and resume after approval/revise.
        this.ticketsStarted = Math.max(0, this.ticketsStarted - 1);
        this.deps.onLog(
          `  ${issue.identifier}: worker reaped (awaiting human confirmation)`,
          "gray",
        );
        this.deps.onWorkersChanged();
        this.spawnNext();
        return;
      }
      const ok = code === 0;
      this.deps.onLog(
        `${ok ? "✓" : "✗"} ${issue.identifier} → ${prep.changeName} exited (code ${code})`,
        ok ? "green" : "red",
      );
      emitCapture(this.bus, "agent_worker_exited", {
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

  /** Kill the active worker for `changeName` and re-queue the same issue
   *  as a `resume` so steering applied between iterations takes effect
   *  immediately. Returns `false` if the coordinator is stopped or no
   *  active worker matches. */
  async restartWorker(changeName: string): Promise<boolean> {
    if (this.stopped) return false;
    const worker = this.workers.find((w) => w.changeName === changeName);
    if (!worker) return false;
    if (worker.restarting) return true;
    worker.restarting = true;
    emitCapture(this.bus, "agent_worker_restarted", {
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
    const worker = this.workers.find((w) => w.changeName === changeName);
    if (!worker) return false;
    if (worker.reapedForAwaiting) return true;
    worker.reapedForAwaiting = true;
    emitCapture(this.bus, "agent_worker_reaped_for_awaiting", { change_name: changeName });
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
    const w = this.workers.find((w) => w.changeName === changeName);
    return w ? w.reapedForAwaiting : false;
  }

  /** Fire the onSteeringAppended hook (if configured). Best-effort —
   *  errors are logged via onLog and never thrown to the caller so the
   *  MCP `ralph_append_steering` tool stays idempotent. */
  async notifySteeringAppended(changeName: string, message: string): Promise<void> {
    if (!this.deps.onSteeringAppended) return;
    try {
      await this.deps.onSteeringAppended(changeName, message);
    } catch (err) {
      this.deps.onLog(
        `! onSteeringAppended failed for ${changeName}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  private async notifyExited(
    issue: LinearIssue,
    changeName: string,
    code: number,
    mode: SpawnMode,
  ): Promise<void> {
    const ok = code === 0;
    if (this.deps.syncTasks && ok) {
      const synthetic: ActiveWorker = {
        changeName,
        issueId: issue.id,
        issueIdentifier: issue.identifier,
        issue,
        mode,
        kill: () => {},
        lastReportedIteration: 0,
        lastSyncedIteration: 0,
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
            emitCapture(this.bus, "agent_indicator_failed", {
              indicator: "clearConflicted",
              issue_identifier: issue.identifier,
              error: (err as Error).message,
            });
          }
        }
        this.conflictNotified.delete(issue.id);
        this.conflictPromoted.delete(issue.id);
      } else if (this.opts.setDone) {
        try {
          await this.deps.applyIndicator(issue, this.opts.setDone);
          this.deps.onLog(`  ${issue.identifier}: setDone applied`, "gray");
        } catch (err) {
          this.deps.onLog(
            `! Linear setDone failed for ${issue.identifier}: ${(err as Error).message}`,
            "red",
          );
          emitCapture(this.bus, "agent_indicator_failed", {
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
        emitCapture(this.bus, "agent_indicator_failed", {
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
