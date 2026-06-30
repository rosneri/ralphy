import { appendFile } from "node:fs/promises";
import type { GetIndicator, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { IssueTracker, TrackedIssue } from "@ralphy/tracker";
import { issueMatchesGetIndicator } from "../shared/capabilities/linear-client/filters";
import { changeNameForIssue } from "../agent/scaffold";
import type { TicketRow } from "../components/task-pipeline";
import {
  projectBoard,
  type BoardSource,
  type ProjectBoardInputs,
  type TicketSourceKind,
} from "./coordination/project-board";
import {
  emptyPrStatus,
  PrWatcher,
  type PrRecoveryGates,
  type PrScanEffect,
  type PrScanResult,
  type PrStatusBucket,
  type PrStatusCounts,
  type PrWatcherDeps,
} from "./coordination/pr-watcher";
import {
  IssueNotifier,
  type IssueNotifierDeps,
  type IssueNotifierOpts,
} from "./coordination/issue-notifier";
import { WorkerPool } from "./coordination/worker-pool";
import {
  type PrepareResult,
  type WorkerHandle,
  type WorkerPoolDeps,
  type WorkerPoolOpts,
} from "./coordination/worker-pool-support";
import { planIntake } from "./coordination/issue-intake";
import { emitCapture } from "./coordination/telemetry";
import { defaultPriorityFor, orderQueueEntries, type QueueEntry } from "../queue/queue-order";
import type { MentionTrigger, QueueTrigger } from "../queue/queue-order";
import type { Bus } from "@ralphy/events";
import { createNoopBus } from "@ralphy/events";
import { registry as featureRegistry } from "../features/registry";
import { detectFeature, emitFeatureSkipped, runFeature } from "../features/run-feature";
import type { FeatureCtx, FeatureId } from "../features/types";
import {
  FlowActorStore,
  FlowDirector,
  flowMachine,
  preemptionActorLogic,
  type FlowRef,
  type FlowSnapshotView,
} from "@ralphy/core/machines";
import type { ActiveWorker } from "./types";

export { emitCapture } from "./coordination/telemetry";

export type { QueueTrigger, MentionTrigger } from "../queue/queue-order";

export {
  completionCommentBody,
  type PrepareResult,
  type WorkerHandle,
} from "./coordination/worker-pool-support";

/** Per-bucket counts surfaced by `pollOnce` for the dashboard / JSON
 *  output. `found` is the sum across buckets and `added` is how many
 *  the coordinator actually enqueued this tick (after eligibility,
 *  dependency, and ticket-cap checks). */
export interface PollBuckets {
  todo: number;
  inProgress: number;
  conflicted: number;
  /** PRs reported red on CI by `gh pr view` in this poll's merge-state
   *  scan. Mirrors `conflicted`: routed back into the queue as a
   *  `ci-fix` trigger by the same scan that counts them. */
  ciFailed: number;
  review: number;
  mentions: number;
  /** Conflicting / CI-failed PRs the pr-tracker has bailed on (exhausted
   *  auto-recovery attempts). They are NOT auto-retried — they need a human,
   *  so they are surfaced separately rather than hidden inside `conflicted`
   *  (which would read as "Ralph is on it"). Cleared when the ticket is moved
   *  back to Todo to retry, or the PR becomes mergeable. */
  quarantined: number;
  /** In-progress issues whose OpenSpec phase is `awaiting-confirmation`. They
   *  are excluded from the resumable bucket — the coordinator never enqueues
   *  them and they do not consume `concurrency` slots. The poll loop still
   *  surfaces them in this count so the dashboard / JSON output can show
   *  how many tickets are gated awaiting human confirmation. */
  awaiting: number;
}
export type { PrStatusBucket, PrStatusCounts } from "./coordination/pr-watcher";
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
  /** One lifecycle-pipeline row per live ticket, ordered active-worker →
   *  queued → in-progress → todo → mention (first occurrence wins on dedup).
   *  The TUI renders this as the unified TASKS board; `buckets` / `prStatus`
   *  remain for `--json-output` and telemetry. Empty on paused / stopped /
   *  failed polls. */
  board: TicketRow[];
}

const emptyPollResult = (): PollResult => ({
  found: 0,
  added: 0,
  buckets: {
    todo: 0,
    inProgress: 0,
    conflicted: 0,
    ciFailed: 0,
    review: 0,
    mentions: 0,
    quarantined: 0,
    awaiting: 0,
  },
  prStatus: emptyPrStatus(),
  phase: {},
  flow: {},
  board: [],
});

/**
 * The orchestration-side dependency bag (issue #403: `{ tracker, … }` instead
 * of nine flat provider methods). The tracker facade is the single fetch/write
 * surface — `pollOnce` issues one `tracker.poll()` per cycle and every tracker
 * write (indicators, comments, sticky upserts) goes through the same member.
 * The orchestration-only members (`prepare`, `spawnWorker`, lifecycle hooks,
 * …) are declared below.
 *
 * Operationally-meaningful semantics of the facade reads (canonical docs live
 * on `IssueTracker` / `IssueTrackerProvider`):
 *  - A poll bucket is an **empty array** when its backing get-indicator is
 *    unconfigured: `todo` (no `getTodo`), `inProgress` (no `getInProgress`),
 *    `mentions` (mention scanning disabled), `doneCandidates` (no PR remote /
 *    no `setDone`).
 *  - Review work is not polled as its own bucket — it flows through
 *    `mentions` (the scanner enqueues `trigger: "review"`); `buckets.review`
 *    stays `0`.
 *  - `removeIndicator` removes a SetIndicator's labels; status removal is a
 *    no-op. `fetchComments` backs "started" idempotency.
 */
export interface CoordinatorDeps {
  /** The issue-tracker facade (`@ralphy/tracker`): one `poll()` bundle per
   *  cycle plus every tracker write. Built by `createTracker` — the only
   *  place the tracker kind is read. */
  tracker: IssueTracker;
  /**
   * Side-effect: create or reuse a worktree, scaffold the change directory
   * when its `tasks.md` is missing, and run the project's setup script.
   * Returns the change name and (when known) the PR URL. Trigger-specific
   * task prepending (conflict-fix / review) is handled by
   * `prepareTaskForTrigger` after this resolves.
   */
  prepare: (issue: TrackedIssue) => Promise<PrepareResult>;
  /**
   * Optional second-stage prep: prepend a directive task to `tasks.md`
   * and reactivate the loop's state file. Called after `prepare` succeeds
   * and only when the queued trigger semantically requires it
   * (`conflict-fix`). Coordinator invokes it as a courtesy
   * dep so the prepend stays observable; absence is treated as a no-op.
   */
  prepareTaskForTrigger?: (
    issue: TrackedIssue,
    changeName: string,
    trigger: QueueTrigger,
    mention?: MentionTrigger,
  ) => Promise<void>;
  /** Spawn the worker subprocess for `changeName`. The `trigger` is forwarded
   *  so the post-task harness can branch on it (e.g. RLF-82 conflict-fix
   *  verify-only path). */
  spawnWorker: (changeName: string, issue: TrackedIssue, trigger: QueueTrigger) => WorkerHandle;
  /** Check the status of a known PR — mergeable, conflicted, or red on CI.
   *  Returns null if no PR is known for this issue (branch deleted, never
   *  created). `unknown` is used when GitHub hasn't computed mergeability
   *  yet or `gh` failed; the caller skips acting on it. */
  checkPrStatus: (issue: TrackedIssue) => Promise<{ url: string; status: PrStatusBucket } | null>;
  /** Merge a verified-mergeable PR directly (the manual-merge fallback). When
   *  wired, `advancePrToDone` calls this before moving the ticket to done, so a
   *  mergeable PR is actually merged rather than left open. Omitted when
   *  `manualMergeWhenAutoMergeDisabled` is false (then PRs are left for a human
   *  or GitHub's native auto-merge). Returns true on success; a false/throw is
   *  non-fatal — the ticket still advances to done. */
  mergePr?: (prUrl: string) => Promise<boolean>;
  /** True when the worker has registered an open PR for this change this run
   *  (reads the shared `prByChange` map). Used at worker-exit to decide whether
   *  to defer `setDone` to the watcher (PR open + recovery enabled) or apply it
   *  immediately. Optional — when omitted, the exit handler applies `setDone`
   *  immediately as before. */
  hasPrForChange?: (changeName: string) => boolean;
  /** Returns true when the openspec change for this issue has already been
   *  archived locally (i.e. a directory matching
   *  `openspec/changes/archive/*-<changeName>/` exists). Used to detect
   *  finished-but-conflicted in-progress tickets so they can be promoted
   *  into the conflict-fix flow. Optional — when omitted, the conflict
   *  promotion check is a no-op. */
  isChangeArchivedForIssue?: (issue: TrackedIssue) => Promise<boolean>;
  onLog: (text: string, color?: string) => void;
  /** Log lines that should be persisted to the on-disk agent log but not
   *  surfaced in the UI panel (e.g. the per-poll summary). Dropped silently
   *  when not provided. */
  onFileLog?: (text: string) => void;
  onWorkersChanged: () => void;
  /** Returns the current iteration count for an active worker (for
   *  periodic progress comments). */
  getIterationCount?: (changeName: string) => Promise<number>;
  /** Returns a cheap stat-based fingerprint (`mtime:size` per file) covering
   *  the artifacts `syncTasks` consumes — `tasks.md`, `proposal.md`, and
   *  `design.md` — or `null` when none exist. When wired, it gates the
   *  per-poll tasks sync on artifact *content* rather than on the iteration
   *  counter, so mid-iteration checkbox ticks reach Linear at poll cadence
   *  instead of waiting for the iteration to end. */
  getTasksFingerprint?: (changeName: string) => Promise<string | null>;
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
  /** Optional hook: build the per-issue `FeatureCtx` consumed by the
   *  feature registry walk. When provided, the coordinator iterates the
   *  registry for each in-progress issue and lets the first matching
   *  `Feature` claim the poll (skipping the legacy `resume` queue). When
   *  omitted (today's wire layer, until per-slice plumbing lands), the
   *  registry walk is skipped entirely and the legacy branches own the
   *  in-progress path. Stub features in `features/registry.ts` all return
   *  `null` from `detect`, so wiring this dep is observable only as bus
   *  events — behavior is unchanged until a slice replaces its stub. */
  buildFeatureCtx?: (issue: TrackedIssue) => FeatureCtx | null;
  /** Optional: return the absolute path to the openspec change directory for
   *  the given issue (`openspec/changes/<changeName>/`). Used by the flow
   *  machine actor store to persist snapshots to `.ralph-state.json` between
   *  polls. When omitted, snapshots are held in memory only and the flow
   *  machine starts fresh after each coordinator restart. */
  getChangeDir?: (issue: TrackedIssue) => string | null;
}

interface CoordinatorOptions {
  concurrency: number;
  setInProgress?: SetIndicator | undefined;
  setDone?: SetIndicator | undefined;
  setError?: SetIndicator | undefined;
  postComments?: boolean | undefined;
  commentEveryIterations?: number | undefined;
  /** Stop picking up new issues once this many have been started this run (0 = unlimited). */
  maxTickets?: number | undefined;
  /** RLF-97: true when this run opens PRs (`--create-pr` or
   *  `createPrOnSuccess`). Gates done-deferral: only PR-producing runs defer
   *  `setDone` to the watcher. A non-PR run marks the ticket done immediately on
   *  worker success even if a stray PR was discovered for the branch, preserving
   *  the historical immediate-Done contract for those workflows. */
  createsPrs?: boolean | undefined;
  /** When set, conflict-fix items whose issue matches this indicator are
   *  promoted to the head of the queue, ahead of Linear priority. */
  getAutoMerge?: GetIndicator | undefined;
  /** Unified PR-recovery gate (RLF-97). `enabled: false` makes the merge-state
   *  scan a no-op — no recovery and no move-to-done; the worker marks the ticket
   *  done on PR open instead. When `enabled`, the scan advances mergeable PRs to
   *  done regardless of the recovery toggles; `fixConflicts`/`fixCi` only gate
   *  whether conflicting / CI-red PRs are re-queued for recovery. Absent ≡
   *  disabled.
   *
   *  `maxRecoverySessions` is the quarantine threshold: after that many failed
   *  recovery sessions the flow machine routes the ticket to `quarantined`
   *  (RLF-173), applies `setError` once, and stops auto-recovering. The
   *  threshold lives in the persisted actor context — the machine, not a side
   *  file, owns the bail counter. */
  prRecovery?:
    | { enabled: boolean; fixCi: boolean; fixConflicts: boolean; maxRecoverySessions?: number }
    | undefined;
}

export type { ActiveWorker } from "./types";

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
  /** Per-issue queue of pending dequeues, with the spawn mode they should use. */
  private queue: QueueEntry[] = [];
  private stopped = false;
  private paused: PauseState | null = null;

  private readonly bus: Bus;
  /** The one gateway to per-issue flow actors (RFC #402). Keyed by issue.id
   *  so the actor is available before `prepare()` resolves the changeName.
   *  Snapshots persist to `changeDir/.ralph-state.json` when `getChangeDir`
   *  is wired, enabling cross-restart rehydration. Recovery-comment dedup
   *  lives on the persisted snapshot (`recovery.*NotifiedAt`), not in
   *  process-lifetime Sets, so a restart no longer re-posts comments. */
  private readonly director: FlowDirector;
  /** All recurring tracker writes (scan-effect comments, progress, task
   *  sync) — see {@link IssueNotifier}. */
  private readonly notifier: IssueNotifier;
  /** The gh-driven merge-state scan, effects-as-data — see {@link PrWatcher}. */
  private readonly prWatcher: PrWatcher;
  /** Worker lifecycle: prepare → spawn → exit → finalize — see {@link WorkerPool}. */
  private readonly pool: WorkerPool;
  /** doneCandidates bucket of the current cycle's poll snapshot, consumed by
   *  the PR watcher's merge-state scan — so one `tracker.poll()` feeds the
   *  whole cycle. */
  private lastDoneCandidates: TrackedIssue[] = [];

  constructor(
    private readonly deps: CoordinatorDeps,
    private readonly opts: CoordinatorOptions,
  ) {
    this.bus = deps.bus ?? createNoopBus();
    const providedMachine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });
    const flowStore = new FlowActorStore(
      {
        bus: this.bus,
        persist: () => {},
        // Seed each actor's quarantine threshold from the recovery config so
        // the machine — not a side file — owns the bail decision. `0` disables.
        maxRecoveryAttempts: this.opts.prRecovery?.maxRecoverySessions ?? 0,
        // Append a debuggable per-change transition timeline next to the flow
        // snapshot (`.ralph-state.flow.json`). Fire-and-forget — this is an
        // observational side channel and must never block or break a poll.
        onTransition: (_issueId, changeDir, transition) => {
          if (!changeDir) return;
          const path = `${changeDir}/.ralph-state.flow-history.jsonl`;
          const line = `${JSON.stringify({ ts: new Date().toISOString(), ...transition })}\n`;
          void appendFile(path, line).catch(() => {});
        },
        // Surface store-level warnings (rejected snapshots, skipped persists)
        // in the run log instead of the default console.warn.
        warn: (message) => this.deps.onLog(`[warn] ${message}`, "gray"),
      },
      providedMachine,
    );
    this.director = new FlowDirector(flowStore);
    const notifierDeps: IssueNotifierDeps = {
      postComment: (issue, body) => this.deps.tracker.postComment(issue, body),
      applyIndicator: (issue, ind) => this.deps.tracker.applyIndicator(issue, ind),
      removeIndicator: (issue, ind) => this.deps.tracker.removeIndicator(issue, ind),
      mergePr: this.deps.mergePr,
      getIterationCount: this.deps.getIterationCount,
      getTasksFingerprint: this.deps.getTasksFingerprint,
      syncTasks: this.deps.syncTasks,
      director: this.director,
      flowRef: (issue) => this.flowRef(issue),
      onLog: (text, color) => this.deps.onLog(text, color),
      bus: this.bus,
    };
    this.notifier = new IssueNotifier(notifierDeps, this.opts satisfies IssueNotifierOpts);
    const watcherDeps: PrWatcherDeps = {
      // The watcher scans the doneCandidates bucket of the current cycle's
      // poll snapshot — one tracker fetch per poll (issue #403).
      fetchDoneCandidates: async () => this.lastDoneCandidates,
      checkPrStatus: (issue) => this.deps.checkPrStatus(issue),
      director: this.director,
      flowRef: (issue) => this.flowRef(issue),
      issueInSetDoneState: (issue) => this.issueInSetDoneState(issue),
      errorMarkerCleared: (issue) => this.errorMarkerCleared(issue),
      onLog: (text, color) => this.deps.onLog(text, color),
    };
    this.prWatcher = new PrWatcher(
      watcherDeps,
      this.opts.prRecovery satisfies PrRecoveryGates | undefined,
    );
    const poolDeps: WorkerPoolDeps = {
      prepare: (issue) => this.deps.prepare(issue),
      prepareTaskForTrigger: this.deps.prepareTaskForTrigger?.bind(this.deps),
      spawnWorker: (changeName, issue, trigger) =>
        this.deps.spawnWorker(changeName, issue, trigger),
      applyIndicator: (issue, ind) => this.deps.tracker.applyIndicator(issue, ind),
      removeIndicator: (issue, ind) => this.deps.tracker.removeIndicator(issue, ind),
      postComment: (issue, body) => this.deps.tracker.postComment(issue, body),
      fetchComments: (issueId) => this.deps.tracker.fetchComments(issueId),
      hasPrForChange: this.deps.hasPrForChange?.bind(this.deps),
      getIterationCount: this.deps.getIterationCount?.bind(this.deps),
      syncTasks: this.deps.syncTasks?.bind(this.deps),
      onLog: (text, color) => this.deps.onLog(text, color),
      onWorkersChanged: () => this.deps.onWorkersChanged(),
      bus: this.bus,
      director: this.director,
      flowRef: (issue) => this.flowRef(issue),
      dequeue: () => this.queue.shift(),
      requeueFront: (entry) => this.queue.unshift(entry),
    };
    this.pool = new WorkerPool(poolDeps, this.opts satisfies WorkerPoolOpts);
  }

  /** Locator for `issue`'s flow actor: registry key + persistence dir. */
  private flowRef(issue: TrackedIssue): FlowRef {
    return { key: issue.id, changeDir: this.deps.getChangeDir?.(issue) ?? undefined };
  }

  get activeCount(): number {
    return this.pool.workers.length;
  }
  get queuedCount(): number {
    return this.queue.length;
  }
  get activeWorkers(): readonly ActiveWorker[] {
    return this.pool.workers;
  }
  /** How many issues have been started this process run. */
  get ticketsStartedCount(): number {
    return this.pool.ticketsStartedCount;
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

    let todo: TrackedIssue[] = [];
    let inProgress: TrackedIssue[] = [];
    let mentions: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
    try {
      const snapshot = await this.deps.tracker.poll();
      ({ todo, inProgress, mentions } = snapshot);
      this.lastDoneCandidates = snapshot.doneCandidates;
    } catch (err) {
      this.deps.onLog(`! tracker poll failed: ${(err as Error).message}`, "red");
      emitCapture(this.bus, "agent_linear_poll_failed", { error: (err as Error).message });
      return emptyPollResult();
    }

    // Registry walk: let per-feature slices claim in-progress issues
    // before the legacy `resume` path queues them. The confirmation
    // slice (the only non-stub feature today) claims awaiting-
    // confirmation tickets so they never enqueue as `resume` and
    // surface separately under `buckets.awaiting`.
    const claimedByFeature = await this.walkRegistryForInProgress(inProgress);
    const awaitingClaimed = claimedByFeature.get("confirmation") ?? new Set<string>();
    const claimedIds = new Set<string>();
    for (const set of claimedByFeature.values()) for (const id of set) claimedIds.add(id);
    // Split awaiting tickets out of the resumable bucket so the counts
    // surfaced to the dashboard mirror the legacy classification.
    const awaitingCount = awaitingClaimed.size;
    const resumableCount = inProgress.length - awaitingCount;

    if (todo.length + resumableCount + mentions.length + awaitingCount > 0) {
      this.deps.onFileLog?.(
        `  poll: ${todo.length} todo, ${resumableCount} in-progress, ${mentions.length} mention, ${awaitingCount} awaiting`,
      );
    }

    const queuedIds = new Set(this.queue.map((q) => q.issue.id));
    const activeIds = new Set(this.pool.workers.map((w) => w.issueId));
    const eligible = (id: string): boolean =>
      !queuedIds.has(id) &&
      !activeIds.has(id) &&
      !this.pool.pendingIssueIds.has(id) &&
      !claimedIds.has(id);

    if (this.paused) {
      this.deps.onLog(
        `  paused — baseline broken (${this.paused.issueIdentifier}); skipping new pickups`,
        "yellow",
      );
      const buckets: PollBuckets = {
        todo: todo.length,
        inProgress: resumableCount,
        conflicted: 0,
        ciFailed: 0,
        review: 0,
        mentions: mentions.length,
        quarantined: 0,
        awaiting: awaitingCount,
      };
      const found = buckets.todo + buckets.inProgress + buckets.mentions + buckets.awaiting;
      return {
        found,
        added: 0,
        buckets,
        prStatus: emptyPrStatus(),
        phase: {},
        flow: {},
        board: [],
      };
    }

    const maxT = this.opts.maxTickets ?? 0;
    /** True when no more issues should be classified this run. `pendingPicks`
     *  counts resumable classifications not yet pushed to the queue, so the
     *  cap holds mid-classification exactly as it did when each acceptance
     *  pushed immediately. */
    const atTicketLimit = (pendingPicks = 0): boolean => {
      if (maxT === 0) return false;
      const inFlight =
        this.pool.ticketsStartedCount +
        this.queue.length +
        this.pool.workers.length +
        this.pool.pendingIssueIds.size +
        pendingPicks;
      return inFlight >= maxT;
    };

    let added = 0;

    // 1. Classify the in-progress bucket. Issues take precedence on restart —
    //    re-attach first so concurrency budget is honored. Before counting an
    //    issue as resumable, check the PR's state on GitHub: a conflicting /
    //    red-CI PR short-circuits the resume and routes the ticket into the
    //    matching fix flow (promotion); a ticket resting in `awaiting-ci`
    //    already opened its PR and is owned by the merge-state scan (which is
    //    also where the `fixConflicts` / `fixCi` gates live).
    const resumable: TrackedIssue[] = [];
    for (const issue of inProgress) {
      if (atTicketLimit(resumable.length)) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      const view = await this.director.view(this.flowRef(issue));
      if (view.value === "awaiting-ci") continue;
      const noPrYet = view.value === "working"; // machine leaves `working` on PR_OPENED
      if (!noPrYet && (await this.maybePromoteFinishedConflicted(issue, view))) continue;
      resumable.push(issue);
    }

    // Conflicted + CI-failed enqueueing happens inside `scanPrMergeStates`
    // below — gh is the single source of truth for those states.

    // 2. Plan the pickups (eligibility, dependency gate, ticket budget,
    //    bucket precedence) — pure rules in `planIntake`; then materialize:
    //    machine pickup event, queue push, log.
    const inFlightCount =
      this.pool.ticketsStartedCount +
      this.queue.length +
      this.pool.workers.length +
      this.pool.pendingIssueIds.size;
    const plan = planIntake(
      { resumable, mentions, todo },
      {
        busyIds: new Set([...queuedIds, ...activeIds, ...this.pool.pendingIssueIds, ...claimedIds]),
        budget: maxT === 0 ? Infinity : Math.max(0, maxT - inFlightCount),
      },
    );
    for (const blockedIssue of plan.blocked) {
      // File-only: blocked-skip lines recur every poll and flood the UI panel.
      this.deps.onFileLog?.(
        `  ⏸ ${blockedIssue.identifier} skipped — blocked by unresolved dependency`,
      );
    }
    for (const entry of plan.entries) {
      // Pickup events: idle → working / review; ignored when the actor is
      // already mid-flow.
      await this.director.dispatch(
        this.flowRef(entry.issue),
        entry.trigger === "resume"
          ? { type: "RESUME_DETECTED" }
          : entry.trigger === "review"
            ? { type: "REVIEW_TRIGGERED" }
            : { type: "FRESH_PICKED_UP" },
      );
      this.queue.push(entry);
      queuedIds.add(entry.issue.id);
      added += 1;
      this.deps.onLog(
        entry.trigger === "review"
          ? `  ↳ ${entry.issue.identifier} queued (review via ${entry.mention?.source} mention)`
          : `  ↳ ${entry.issue.identifier} queued (${entry.trigger})`,
        "gray",
      );
    }

    // Run the gh-driven merge-state scan BEFORE the queue sort + spawn
    // so its conflict-fix / ci-fix entries get sorted with the rest and
    // auto-merge boost can promote them ahead of urgent todos.
    const { counts: prStatus, prByIssue } = await this.scanPrMergeStates();

    if (this.queue.length > 0) {
      this.queue = orderQueueEntries(this.queue, this.opts.getAutoMerge);
    }

    this.spawnNext();
    await this.notifier.reportProgress(this.pool.workers);
    await this.notifier.syncWorkerTasks(this.pool.workers);

    const buckets: PollBuckets = {
      todo: todo.length,
      inProgress: resumableCount,
      conflicted: prStatus.conflicted,
      ciFailed: prStatus.ciFailed,
      review: 0,
      mentions: mentions.length,
      quarantined: prStatus.quarantined,
      awaiting: awaitingCount,
    };
    const found =
      buckets.todo +
      buckets.inProgress +
      buckets.conflicted +
      buckets.ciFailed +
      buckets.mentions +
      buckets.awaiting;
    const flow: Record<string, Flow> = {};
    for (const w of this.pool.workers) {
      const workerView = this.director.peek(w.issueId);
      if (workerView) {
        const stateVal = workerView.value;
        const validFlowStates: Flow[] = ["conflict-fix", "ci-fix", "awaiting", "review", "working"];
        flow[w.changeName] = (
          validFlowStates.includes(stateVal as Flow) ? stateVal : "working"
        ) as Flow;
      } else {
        this.deps.onLog(
          `[warn] no actor in memory for active worker ${w.changeName} — defaulting flow to "working"`,
          "gray",
        );
        flow[w.changeName] = "working";
      }
    }
    const board = await this.buildBoard({
      todo,
      inProgress,
      mentions,
      prByIssue,
      awaitingIds: awaitingClaimed,
    });
    return { found, added, buckets, prStatus, phase: {}, flow, board };
  }

  /**
   * Build the lifecycle-pipeline board. The shell's only jobs here are
   * assembling the precedence-ordered sources and prefetching the flow
   * snapshot views (rehydrated via the director, so a parked/restarted ticket
   * reports its true state); every projection rule lives in the pure
   * {@link projectBoard}.
   */
  private async buildBoard(args: {
    todo: TrackedIssue[];
    inProgress: TrackedIssue[];
    mentions: { issue: TrackedIssue; trigger: MentionTrigger }[];
    prByIssue: Map<string, { url: string; status: PrStatusBucket }>;
    /** Issue ids claimed by the awaiting-confirmation feature. Rendered as
     *  `awaiting` rows in the board (no separate gate card) so a gated ticket
     *  lives in the same list as everything else. */
    awaitingIds: ReadonlySet<string>;
  }): Promise<TicketRow[]> {
    const { todo, inProgress, mentions, prByIssue, awaitingIds } = args;
    const sources: BoardSource[] = [
      ...this.pool.workers.map((w) => ({
        issue: w.issue,
        kind: "worker" as const,
        changeName: w.changeName,
      })),
      ...this.queue.map((q) => ({
        issue: q.issue,
        kind: "queued" as const,
        changeName: changeNameForIssue(q.issue),
      })),
      ...inProgress.map((issue) => ({
        issue,
        // A gated ticket rests in awaiting-confirmation; force the `awaiting`
        // row so it reads as a human-gated step rather than active work.
        kind: (awaitingIds.has(issue.id) ? "awaiting" : "in-progress") as TicketSourceKind,
        changeName: changeNameForIssue(issue),
      })),
      ...todo.map((issue) => ({
        issue,
        kind: "todo" as const,
        changeName: changeNameForIssue(issue),
      })),
      ...mentions.map((m) => ({
        issue: m.issue,
        kind: "mention" as const,
        changeName: changeNameForIssue(m.issue),
      })),
    ];

    // Prefetch the snapshot views the projection will read — exactly the
    // first-occurrence sources whose row is actor-backed (everything except
    // direct-assigned todo/mention/awaiting rows and blocked parked rows).
    const snapshots = new Map<string, FlowSnapshotView>();
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.issue.id)) continue;
      seen.add(source.issue.id);
      const direct =
        source.kind === "todo" || source.kind === "mention" || source.kind === "awaiting";
      const blockedParked = source.kind !== "worker" && source.issue.blockedByIds.length > 0;
      if (direct || blockedParked) continue;
      snapshots.set(source.issue.id, await this.director.view(this.flowRef(source.issue)));
    }

    const prUrlByIssue = new Map<string, string>();
    for (const [id, pr] of prByIssue) prUrlByIssue.set(id, pr.url);

    const inputs: ProjectBoardInputs = { sources, snapshots, prUrlByIssue };
    return projectBoard(inputs);
  }

  /**
   * Iterate the feature registry over each in-progress issue. The first
   * feature whose `detect` returns a non-null match claims the issue and
   * its `run` is invoked under `runFeature` (which translates throws into
   * `feature.<id>.failed` bus events). Lower-priority detectors get a
   * `feature.<id>.skipped` event so telemetry stays symmetric. Issues
   * that no feature claims fall through to the legacy `resume` path.
   *
   * Skipped entirely when `buildFeatureCtx` is not wired — the legacy
   * branches still own the in-progress path in that case.
   */
  private async walkRegistryForInProgress(
    inProgress: readonly TrackedIssue[],
  ): Promise<Map<FeatureId, Set<string>>> {
    const claimed = new Map<FeatureId, Set<string>>();
    if (!this.deps.buildFeatureCtx) return claimed;
    for (const issue of inProgress) {
      const ctx = this.deps.buildFeatureCtx(issue);
      if (!ctx) continue;

      const wasAwaiting = (await this.director.view(this.flowRef(issue))).value === "awaiting";

      let matchedId: FeatureId | null = null;
      for (const feature of featureRegistry) {
        if (matchedId !== null) {
          emitFeatureSkipped(ctx.bus, feature.id, `preempted-by:${matchedId}`);
          continue;
        }
        const match = await detectFeature(feature, ctx);
        if (match) {
          matchedId = feature.id;
          await runFeature(feature, ctx, match);
          let bucket = claimed.get(feature.id);
          if (!bucket) {
            bucket = new Set<string>();
            claimed.set(feature.id, bucket);
          }
          bucket.add(issue.id);
        }
      }

      const confirmationClaimed = claimed.get("confirmation")?.has(issue.id) ?? false;
      if (confirmationClaimed) {
        await this.director.dispatch(this.flowRef(issue), { type: "AWAITING_DETECTED" });
      } else if (wasAwaiting) {
        await this.director.dispatch(this.flowRef(issue), { type: "CONFIRMATION_CLEARED" });
      }
    }
    return claimed;
  }

  /**
   * Detect in-progress tickets whose open PR is conflicting with main or
   * red on CI, and promote them straight into the matching fix flow
   * (`conflict-fix` or `ci-fix`). The promotion short-circuits the
   * resume queue and posts a one-line Linear comment for visibility —
   * no Linear labels are involved in the routing (GitHub is the source
   * of truth for merge state).
   *
   * Returns true when the ticket was promoted (or is already promoted) and
   * should be skipped from the in-progress queue this poll.
   */
  private async maybePromoteFinishedConflicted(
    issue: TrackedIssue,
    view: FlowSnapshotView,
  ): Promise<boolean> {
    // RLF-97: honor the same recovery gates as `scanPrMergeStates` at this
    // second detection site. Without these, a non-awaiting-ci in-progress
    // ticket whose PR goes red would still spawn a fix worker even when
    // recovery (or the matching toggle) is off — so "off" would not mean off.
    // Returning false lets the ticket fall through to the normal resume path.
    if (!this.opts.prRecovery?.enabled) return false;

    // Already promoted into a fix flow — by an earlier poll or, since the
    // snapshot persists, by a previous process. Skip the resume path; if the
    // restart emptied the queue, re-enqueue the fix run without re-sending a
    // detection or re-posting the promotion comment.
    if (view.value === "conflict-fix" || view.value === "ci-fix") {
      if (view.value === "conflict-fix" && !this.opts.prRecovery.fixConflicts) return false;
      if (view.value === "ci-fix" && !this.opts.prRecovery.fixCi) return false;
      this.ensureFixQueued(issue, view.value);
      return true;
    }
    // A failed fix worker parked the actor in terminal `error` — a human owns
    // it now (clear the error marker to retry). Keep it out of the resume
    // queue rather than burning recovery sessions on it every poll.
    if (view.value === "error") return true;

    let pr: { url: string; status: PrStatusBucket } | null;
    try {
      pr = await this.deps.checkPrStatus(issue);
    } catch (err) {
      this.deps.onLog(
        `! PR status check failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return false;
    }
    if (!pr) return false;
    if (pr.status !== "conflicted" && pr.status !== "ci_failed") return false;
    if (pr.status === "conflicted" && !this.opts.prRecovery.fixConflicts) return false;
    if (pr.status === "ci_failed" && !this.opts.prRecovery.fixCi) return false;

    const stateLabel = pr.status === "conflicted" ? "conflicting with main" : "failing CI";
    const trigger: QueueTrigger = pr.status === "conflicted" ? "conflict-fix" : "ci-fix";

    // Drive the flow machine (RESUME first when idle — e.g. fresh restart
    // without a snapshot); it owns the demote-vs-quarantine decision.
    const detection =
      pr.status === "conflicted"
        ? ({ type: "CONFLICT_DETECTED", at: new Date().toISOString(), prUrl: pr.url } as const)
        : ({ type: "CI_FAILED_DETECTED", at: new Date().toISOString(), prUrl: pr.url } as const);
    const after =
      view.value === "idle"
        ? await this.director.dispatch(this.flowRef(issue), { type: "RESUME_DETECTED" }, detection)
        : await this.director.dispatch(this.flowRef(issue), detection);
    if (after.value === "quarantined") {
      if (!after.recovery?.bailNotifiedAt) {
        await this.notifier.bail(
          issue,
          pr.url,
          detection.type === "CONFLICT_DETECTED" ? "conflicting" : "ci_failed",
          after.recovery?.attempts ?? 0,
        );
      }
      return true;
    }

    emitCapture(this.bus, "agent_conflict_promoted", {
      issue_identifier: issue.identifier,
      pr_url: pr.url,
      trigger,
    });
    this.deps.onLog(
      `  ${issue.identifier}: promoted to ${trigger} (PR ${pr.url} ${stateLabel})`,
      "yellow",
    );

    if (!after.recovery?.promotionNotifiedAt) {
      await this.notifier.notifyPromotion(issue, trigger, pr.url, stateLabel);
    }

    this.queue.push({
      issue,
      trigger,
      priority: defaultPriorityFor(trigger),
    });
    return true;
  }

  /** Returns true if all `blockedByIds` are not present in `inProgress`/
   *  `todo` view — i.e. they're either completed or external. The Linear
   *  fetch already filters out blockers in completed/cancelled states, so
   *  any remaining blocker is genuinely open. */
  private dependenciesResolved(issue: TrackedIssue): boolean {
    if (issue.blockedByIds.length === 0) return true;
    const openIds = new Set([
      ...this.queue.map((q) => q.issue.id),
      ...this.pool.workers.map((w) => w.issueId),
    ]);
    const blocker = issue.blockedByIds.find((bid) => openIds.has(bid));
    if (blocker !== undefined) {
      // File-only: this fires every poll for a blocked issue; UI noise.
      this.deps.onFileLog?.(`  ⏸ ${issue.identifier} skipped — blocked by unresolved dependency`);
      return false;
    }
    // Blockers that aren't in our open view: trust Linear's `blocked_by`
    // pruning (only unresolved blockers are returned). They might still be
    // genuinely open elsewhere — log and skip.
    this.deps.onFileLog?.(`  ⏸ ${issue.identifier} skipped — blocked by unresolved dependency`);
    return false;
  }

  /**
   * For every done-candidate ticket (status=setDone with an open PR),
   * read the PR's merge + CI state from GitHub. Conflicting and CI-red
   * PRs are queued for re-fix runs (`conflict-fix` / `ci-fix`). The
   * persisted flow snapshot's `recovery.*NotifiedAt` stamps dedup across
   * polls — Linear labels are no longer involved in the routing.
   */
  private async scanPrMergeStates(): Promise<{
    counts: PrStatusCounts;
    prByIssue: Map<string, { url: string; status: PrStatusBucket }>;
  }> {
    // Tickets with an active, pending, or queued worker are in flight — the
    // watcher leaves them alone.
    const skipIds = new Set<string>();
    for (const w of this.pool.workers) skipIds.add(w.issueId);
    for (const id of this.pool.pendingIssueIds) skipIds.add(id);
    for (const q of this.queue) skipIds.add(q.issue.id);
    // Fix items already queued or running were detected in a prior scan and
    // skipped by the watcher — pass them in so the standing-level counters
    // stay accurate without double-counting this scan's own effects.
    const preexistingFix = { conflicted: 0, ciFailed: 0 };
    for (const q of this.queue) {
      if (q.trigger === "conflict-fix") preexistingFix.conflicted += 1;
      else if (q.trigger === "ci-fix") preexistingFix.ciFailed += 1;
    }
    for (const w of this.pool.workers) {
      if (w.trigger === "conflict-fix") preexistingFix.conflicted += 1;
      else if (w.trigger === "ci-fix") preexistingFix.ciFailed += 1;
    }

    const scan: PrScanResult = await this.prWatcher.scan({ skipIds, preexistingFix });
    for (const effect of scan.effects) {
      await this.applyScanEffect(effect);
    }
    return { counts: scan.counts, prByIssue: scan.prByIssue };
  }

  /** Apply one scan effect: queueing stays here (the shell owns the queue);
   *  all tracker writes go through the notifier. */
  private async applyScanEffect(effect: PrScanEffect): Promise<void> {
    if (effect.kind === "advance-done") {
      await this.notifier.advanceToDone(effect.issue, effect.prUrl);
      return;
    }
    if (effect.kind === "bail") {
      await this.notifier.bail(effect.issue, effect.prUrl, effect.reason, effect.attempts);
      return;
    }
    // enqueue-fix: a resumed session (post-restart) only needs its worker
    // back; a fresh detection also logs, captures telemetry, and notifies.
    if (!effect.fresh) {
      this.ensureFixQueued(effect.issue, effect.trigger);
      return;
    }
    if (effect.trigger === "conflict-fix") {
      emitCapture(this.bus, "agent_conflict_detected", {
        issue_identifier: effect.issue.identifier,
      });
    } else {
      emitCapture(this.bus, "agent_ci_failed_detected", {
        issue_identifier: effect.issue.identifier,
      });
    }
    this.deps.onLog(
      `  ${effect.issue.identifier}: PR ${effect.prUrl} ${effect.trigger === "conflict-fix" ? "conflicting" : "CI failing"} — queued (${effect.trigger})`,
      "yellow",
    );
    if (effect.notifyDetection) {
      await this.notifier.notifyDetection(effect.issue, effect.trigger, effect.prUrl);
    }
    this.queue.push({
      issue: effect.issue,
      trigger: effect.trigger,
      priority: defaultPriorityFor(effect.trigger),
    });
  }

  /**
   * RFC #402 pinned behavior: a ticket resting in a fix state with no active,
   * pending, or queued worker (the post-restart case) is re-enqueued for the
   * matching fix run — without re-sending a detection and without re-posting
   * any comment (the snapshot's notification stamps already record those).
   */
  private ensureFixQueued(issue: TrackedIssue, trigger: "conflict-fix" | "ci-fix"): void {
    if (this.pool.workers.some((w) => w.issueId === issue.id)) return;
    if (this.pool.pendingIssueIds.has(issue.id)) return;
    if (this.queue.some((q) => q.issue.id === issue.id)) return;
    this.queue.push({ issue, trigger, priority: defaultPriorityFor(trigger) });
    this.deps.onLog(
      `  ↳ ${issue.identifier} re-queued (${trigger} — resuming interrupted recovery)`,
      "yellow",
    );
  }

  /** True when `setError` is configured (a quarantine label) but the issue no
   *  longer carries it — i.e. a human cleared the label to request a retry.
   *  Used to release a quarantine. Returns false when no label-type setError is
   *  configured (then a quarantine only clears on a mergeable PR). */
  /** True when the issue already carries the `setDone` marker(s) — i.e. it is
   *  already in the done state (status and/or label). Used to suppress a
   *  redundant advance-to-done on a ticket that reached done by another path. */
  private issueInSetDoneState(issue: TrackedIssue): boolean {
    const sd = this.opts.setDone;
    if (!sd) return false;
    return issueMatchesGetIndicator(issue, { filter: markersOf(sd) });
  }

  private errorMarkerCleared(issue: TrackedIssue): boolean {
    const se = this.opts.setError;
    if (!se) return false;
    const wantLabels = markersOf(se)
      .filter((m) => m.type === "label")
      .map((m) => m.value.toLowerCase());
    if (wantLabels.length === 0) return false;
    const have = new Set(issue.labels.map((l) => l.toLowerCase()));
    return !wantLabels.some((v) => have.has(v));
  }

  /** Fill free worker slots from the queue. */
  spawnNext(): void {
    this.pool.fill();
  }

  /** Test-only barrier — see {@link WorkerPool.whenSettled}. */
  async whenSettled(): Promise<void> {
    return this.pool.whenSettled();
  }

  /** Kill the active worker for `changeName` and re-queue the same issue
   *  as a `resume` so steering applied between iterations takes effect
   *  immediately. Returns `false` if the coordinator is stopped or no
   *  active worker matches. */
  async restartWorker(changeName: string): Promise<boolean> {
    if (this.stopped) return false;
    return this.pool.restartWorker(changeName);
  }

  /** Kill the active worker for `changeName` because the ticket has
   *  flipped into `awaiting-confirmation` — see {@link WorkerPool.reapForAwaiting}. */
  reapForAwaiting(changeName: string): boolean {
    if (this.stopped) return false;
    return this.pool.reapForAwaiting(changeName);
  }

  /** True when there is an active worker reaped (or being reaped) for
   *  awaiting-confirmation. Used by the wire layer to suppress PR
   *  creation in the post-task block of that worker's exit handler. */
  isAwaitingConfirmation(changeName: string): boolean {
    return this.pool.isAwaitingConfirmation(changeName);
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

  stop(): void {
    this.stopped = true;
    this.pool.stop();
  }
}

import type { BoostBand } from "./types";

const BOOST_RANK: Record<BoostBand, number> = { p0: 0, p1: 1, p2: 2, p3: 3 };

/** Entry shape consumed by `compareByBoost` — issue's boost band plus
 *  the epoch-ms it was added to the queue. Lower boost rank wins; ties
 *  break FIFO (earlier `addedAt` first). */
interface BoostQueueEntry {
  boost: BoostBand;
  addedAt: number;
}

/** Boost-aware queue comparator. p0 first, then FIFO within a band. */
export function compareByBoost<T extends BoostQueueEntry>(a: T, b: T): number {
  const r = BOOST_RANK[a.boost] - BOOST_RANK[b.boost];
  if (r !== 0) return r;
  return a.addedAt - b.addedAt;
}
