import { appendFile } from "node:fs/promises";
import type { GetIndicator, SetIndicator } from "@ralphy/types";
import { markersOf } from "@ralphy/types";
import type { TrackedIssue } from "@ralphy/tracker";
import { issueMatchesGetIndicator } from "../shared/capabilities/linear-client";
import { NO_CHANGES_EXIT } from "../agent/post-task";
import { changeNameForIssue } from "../agent/scaffold";
import {
  machineStateToTicketState,
  type TicketRow,
  type TicketState,
  type TicketRecovery,
} from "../components/task-pipeline";
import { defaultPriorityFor, orderQueueEntries, type QueueEntry } from "../queue/queue-order";
import type { MentionTrigger, QueueTrigger } from "../queue/queue-order";
import { capture as telemetryCapture } from "@ralphy/telemetry";
import type { Bus, EmitInput, RalphEvent } from "@ralphy/events";
import { createNoopBus } from "@ralphy/events";
import { registry as featureRegistry } from "../features/registry";
import { detectFeature, emitFeatureSkipped, runFeature } from "../features/run-feature";
import type { FeatureCtx, FeatureId } from "../features/types";
import type { PrTracker } from "../features/pr-tracker";
import { FlowActorStore, flowMachine, preemptionActorLogic } from "@ralphy/core/machines";
import { buildRalphyComment, isStartedComment } from "@ralphy/comms";
import type { FlowAssignment, FlowId } from "./types";

/**
 * Stage 1: Emits to PostHog AND to the event bus side-by-side. The legacy
 * `capture(event, props)` call sites switch to `capture.call(this, ...)`
 * via a small helper so neither sink is missed.
 */
export function emitCapture<T extends RalphEvent["type"]>(
  bus: Bus,
  event: T,
  properties?: Record<string, unknown>,
): void {
  telemetryCapture(event, properties);
  bus.emit({ type: event, ...properties } as Extract<EmitInput, { type: T }>);
}

export type { QueueTrigger, MentionTrigger } from "../queue/queue-order";

/** Build the Linear completion comment for a finished worker. Split out to
 *  keep the three outcomes (no-op done / success / quarantined failure) as a
 *  flat branch rather than nested ternaries. */
function completionCommentBody(args: {
  noChanges: boolean;
  ok: boolean;
  trigger: QueueTrigger;
  changeName: string;
  code: number;
}): string {
  const { noChanges, ok, trigger, changeName, code } = args;
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
  return buildRalphyComment({
    type: "completed",
    action: "completed work",
    body: `Change: \`${changeName}\``,
    fields: { change: changeName },
  });
}

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
  /** Working directory the worker runs in (the worktree when useWorktree is
   *  on). Carried onto the ActiveWorker so post-exit syncTasks flushes can
   *  resolve change artifacts after the wire layer has released its
   *  per-change maps. */
  cwd?: string;
}

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
/** Per-status counts across the done-candidate PRs scanned this tick.
 *  Surfaced in the dashboard so operators can see at a glance how many
 *  shipped PRs are mergeable, blocked by merge conflicts, or red on CI. */
export interface PrStatusCounts {
  mergeable: number;
  conflicted: number;
  ciFailed: number;
  /** Conflicting / CI-failed PRs the pr-tracker has bailed on — counted as a
   *  standing level each scan (not a one-shot delta) so the dashboard shows
   *  how many PRs are stuck needing a human. */
  quarantined: number;
}
export type PrStatusBucket = "mergeable" | "conflicted" | "ci_failed" | "unknown";
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
const emptyPrStatus = (): PrStatusCounts => ({
  mergeable: 0,
  conflicted: 0,
  ciFailed: 0,
  quarantined: 0,
});

/** Number of consecutive macrotask hops {@link AgentCoordinator.whenSettled}
 *  must observe an empty in-flight set before it concludes the system is idle.
 *  A worker's finalization enrolls only after its exit promise resolves, and
 *  under load that resolve→enroll chain can span more than one macrotask hop;
 *  requiring several stable observations closes that window without ever
 *  hanging on a still-running worker. Test-only barrier. */
const WHEN_SETTLED_STABLE_HOPS = 3;

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

export interface CoordinatorDeps {
  /** Issues to pick up. Empty array if `getTodo` isn't configured. */
  fetchTodo: () => Promise<TrackedIssue[]>;
  /** Issues to resume after restart. Empty array if `getInProgress` isn't configured. */
  fetchInProgress: () => Promise<TrackedIssue[]>;
  /** Done issues with new `@ralphy` mentions on Linear or their tracked
   *  GitHub PR. Empty array if mention scanning is disabled. */
  fetchMentions: () => Promise<{ issue: TrackedIssue; trigger: MentionTrigger }[]>;
  /** Issues with `setDone` applied that ralph should scan for PR conflicts.
   *  Empty array if conflict-scan isn't configured (no PR remote / no `setDone`). */
  fetchDoneCandidates: () => Promise<TrackedIssue[]>;
  /**
   * Forward-compat (RLF-223 M2): issues in the configured `getReview` bucket.
   * Completes the `IssueTrackerProvider` surface so `CoordinatorDeps` is a
   * faithful superset of the provider. **Not polled today** — `pollOnce` never
   * calls this and `buckets.review` stays `0`; review work still flows through
   * `fetchMentions` (the scanner enqueues `trigger: "review"`). A future
   * milestone wires a real review poll here.
   */
  fetchReview: () => Promise<TrackedIssue[]>;
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
  /** Apply a SetIndicator (label add and/or status set) to the issue. */
  applyIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
  /** Remove a SetIndicator's labels from the issue. Status removal is a no-op. */
  removeIndicator: (issue: TrackedIssue, ind: SetIndicator) => Promise<void>;
  /** Post a comment to the Linear issue. */
  postComment: (issue: TrackedIssue, body: string) => Promise<void>;
  /** Fetch existing Linear comments — used for "started" idempotency. */
  fetchComments: (issueId: string) => Promise<{ body: string }[]>;
  /** Check the status of a known PR — mergeable, conflicted, or red on CI.
   *  Returns null if no PR is known for this issue (branch deleted, never
   *  created). `unknown` is used when GitHub hasn't computed mergeability
   *  yet or `gh` failed; the caller skips acting on it. */
  checkPrStatus: (issue: TrackedIssue) => Promise<{ url: string; status: PrStatusBucket } | null>;
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
  /** Optional pr-tracker (RLF-173). When provided, the merge-state scan
   *  records every CONFLICTING / CI-failed detection and bails to
   *  `setError` once `maxRecoverySessions` is exceeded. Healthy
   *  (mergeable) PRs clear their counter. Absence preserves the legacy
   *  "demote forever" behavior. */
  prTracker?: PrTracker | undefined;
  /** Unified PR-recovery gate (RLF-97). `enabled: false` makes the merge-state
   *  scan a no-op — no recovery and no move-to-done; the worker marks the ticket
   *  done on PR open instead. When `enabled`, the scan advances mergeable PRs to
   *  done regardless of the recovery toggles; `fixConflicts`/`fixCi` only gate
   *  whether conflicting / CI-red PRs are re-queued for recovery. Absent ≡
   *  disabled. */
  prRecovery?: { enabled: boolean; fixCi: boolean; fixConflicts: boolean } | undefined;
}

export interface ActiveWorker {
  changeName: string;
  issueId: string;
  issueIdentifier: string;
  issue: TrackedIssue;
  trigger: QueueTrigger;
  /** Worker working directory from {@link PrepareResult.cwd}. Lets the
   *  awaiting-reap / done syncTasks flush read the change artifacts from the
   *  worktree even after the wire layer's exit handler has already cleared
   *  `cwdByChange` (otherwise the flush silently falls back to projectRoot,
   *  where the change files may not exist — no design attachment uploaded). */
  cwd?: string;
  kill: () => void;
  /** Highest iteration count we've already posted a progress comment for. */
  lastReportedIteration: number;
  /** Iteration count last passed to `syncTasks`. Lets the poll loop skip
   *  re-syncing when the worker hasn't ticked a new iteration. Initialized
   *  to 0 on spawn since the launch path syncs iteration 0 immediately. */
  lastSyncedIteration: number;
  /** Artifact fingerprint last passed to `syncTasks` (via
   *  `getTasksFingerprint`). The poll loop gates on this when the dep is
   *  wired, so mid-iteration `tasks.md` ticks sync at poll cadence. Left
   *  unchanged on sync failure so the next poll retries. Initialized to
   *  `null`; the first poll captures the launch-time fingerprint. */
  lastSyncedTasksFingerprint: string | null;
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

/** Which input source a board row was resolved from, in precedence order.
 *  Decides the base state before pr-tracker overlays apply. */
type TicketSourceKind = "worker" | "queued" | "in-progress" | "todo" | "mention";

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
  /** Detached async continuations kicked off by the poll loop —
   *  `launchWorker` (fire-and-forget from `spawnNext`) and each worker's
   *  exit continuation. Tracked so {@link whenSettled} can deterministically
   *  await them; production never reads it, but tests need a non-racy seam
   *  to know all spawn/exit side-effects have flushed. */
  private inFlight = new Set<Promise<unknown>>();
  /** Per-issue queue of pending dequeues, with the spawn mode they should use. */
  private queue: QueueEntry[] = [];
  private stopped = false;
  private paused: PauseState | null = null;
  /** Issues we've already detected as conflicted in this process —
   *  guards against re-queueing + re-posting the conflict comment every
   *  poll. Cleared once the conflict-fix worker exits successfully so
   *  the next gh-driven scan re-arms. */
  private conflictNotified = new Set<string>();
  /** Symmetric to `conflictNotified` for the ci-fix lifecycle. */
  private ciFailedNotified = new Set<string>();
  /** Issue IDs we've already posted a "promoted to conflict-fix / ci-fix"
   *  comment for in this process run. Cleared when the matching worker
   *  exits successfully. */
  private conflictPromoted = new Set<string>();
  /** Total issues launched this process run — used to enforce maxTickets. */
  private ticketsStarted = 0;

  private readonly bus: Bus;
  /** Per-issue XState v5 actor store. Keyed by issue.id so the actor is
   *  available before `prepare()` resolves the changeName. Snapshots are
   *  persisted to `changeDir/.ralph-state.json` when `getChangeDir` is
   *  wired, enabling cross-restart rehydration. */
  private readonly flowStore: FlowActorStore;

  constructor(
    private readonly deps: CoordinatorDeps,
    private readonly opts: CoordinatorOptions,
  ) {
    this.bus = deps.bus ?? createNoopBus();
    const providedMachine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });
    this.flowStore = new FlowActorStore(
      {
        bus: this.bus,
        persist: () => {},
        // Append a debuggable per-change transition timeline next to the flow
        // snapshot (`.ralph-state.flow.json`). Fire-and-forget — this is an
        // observational side channel and must never block or break a poll.
        onTransition: (_issueId, changeDir, transition) => {
          if (!changeDir) return;
          const path = `${changeDir}/.ralph-state.flow-history.jsonl`;
          const line = `${JSON.stringify({ ts: new Date().toISOString(), ...transition })}\n`;
          void appendFile(path, line).catch(() => {});
        },
      },
      providedMachine,
    );
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

    let todo: TrackedIssue[] = [];
    let inProgress: TrackedIssue[] = [];
    let mentions: { issue: TrackedIssue; trigger: MentionTrigger }[] = [];
    try {
      [todo, inProgress, mentions] = await Promise.all([
        this.deps.fetchTodo(),
        this.deps.fetchInProgress(),
        this.deps.fetchMentions(),
      ]);
    } catch (err) {
      this.deps.onLog(`! Linear poll failed: ${(err as Error).message}`, "red");
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
    const activeIds = new Set(this.workers.map((w) => w.issueId));
    const eligible = (id: string): boolean =>
      !queuedIds.has(id) && !activeIds.has(id) && !this.pendingIds.has(id) && !claimedIds.has(id);

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
    //    check the PR's state on GitHub: a conflicting / red-CI PR
    //    short-circuits the resume and routes the ticket into the matching
    //    fix flow.
    for (const issue of inProgress) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      // RLF-97: a ticket resting in `awaiting-ci` already opened its PR and is
      // waiting for the watcher to advance it to done (PR_PASSED) or re-engage
      // recovery. It must NOT be re-run as a resume — `scanPrMergeStates` owns
      // it from here, which is also where the `fixConflicts` / `fixCi` gates
      // live, so routing it through the scan keeps recovery gating in one place.
      const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
      const actor = await this.flowStore.getActor(issue.id, changeDir);
      if ((actor.getSnapshot().value as string) === "awaiting-ci") continue;
      if (await this.maybePromoteFinishedConflicted(issue)) continue;
      // Send RESUME_DETECTED to actor (idle → working; ignored if already in working/conflict-fix/etc.)
      actor.send({ type: "RESUME_DETECTED" });
      if (changeDir) {
        await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
      }
      this.queue.push({
        issue,
        trigger: "resume",
        priority: defaultPriorityFor("resume"),
      });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (resume)`, "gray");
    }

    // Conflicted + CI-failed enqueueing happens inside `scanPrMergeStates`
    // below — gh is the single source of truth for those states.

    // 3. @ralphy mention triggers — Linear / GitHub comments newer than
    //     Ralph's last review-pickup ack. The trigger body becomes the task.
    for (const { issue, trigger: mention } of mentions) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      // Send REVIEW_TRIGGERED to actor (idle → review)
      const mentionChangeDir = this.deps.getChangeDir?.(issue) ?? undefined;
      const mentionActor = await this.flowStore.getActor(issue.id, mentionChangeDir);
      mentionActor.send({ type: "REVIEW_TRIGGERED" });
      if (mentionChangeDir) {
        await this.flowStore.persistActor(issue.id, mentionChangeDir).catch(() => {});
      }
      this.queue.push({
        issue,
        trigger: "review",
        priority: defaultPriorityFor("review"),
        mention,
      });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(
        `  ↳ ${issue.identifier} queued (review via ${mention.source} mention)`,
        "gray",
      );
    }

    // 4. Fresh todo.
    for (const issue of todo) {
      if (atTicketLimit()) break;
      if (!eligible(issue.id)) continue;
      if (!this.dependenciesResolved(issue)) continue;
      // Send FRESH_PICKED_UP to actor (idle → working)
      const freshChangeDir = this.deps.getChangeDir?.(issue) ?? undefined;
      const freshActor = await this.flowStore.getActor(issue.id, freshChangeDir);
      freshActor.send({ type: "FRESH_PICKED_UP" });
      if (freshChangeDir) {
        await this.flowStore.persistActor(issue.id, freshChangeDir).catch(() => {});
      }
      this.queue.push({
        issue,
        trigger: "fresh",
        priority: defaultPriorityFor("fresh"),
      });
      queuedIds.add(issue.id);
      added += 1;
      this.deps.onLog(`  ↳ ${issue.identifier} queued (fresh)`, "gray");
    }

    // Run the gh-driven merge-state scan BEFORE the queue sort + spawn
    // so its conflict-fix / ci-fix entries get sorted with the rest and
    // auto-merge boost can promote them ahead of urgent todos.
    const { counts: prStatus, prByIssue } = await this.scanPrMergeStates();

    if (this.queue.length > 0) {
      this.queue = orderQueueEntries(this.queue, this.opts.getAutoMerge);
    }

    this.spawnNext();
    await this.reportProgress();
    await this.syncWorkerTasks();

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
    for (const w of this.workers) {
      const workerActor = this.flowStore.peekActor(w.issueId);
      if (workerActor) {
        const stateVal = workerActor.getSnapshot().value as string;
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
      excludeIds: awaitingClaimed,
    });
    return { found, added, buckets, prStatus, phase: {}, flow, board };
  }

  /**
   * Build the lifecycle-pipeline board — one {@link TicketRow} per live
   * ticket. Sources are walked in precedence order (active worker → queued →
   * in-progress → todo → mention); the first occurrence of an issue id wins,
   * which also fixes the render order. State comes from the persisted flow
   * actor (rehydrated via `getActor`, so a parked/restarted ticket reports its
   * true state) for actor-backed rows; `todo` / `review` are assigned directly
   * for the backlog and mention sources (no actor materialized for them).
   *
   * Two overlays apply to actor-backed rows only:
   *  - a pr-tracker **bail** wins outright → `quarantined`;
   *  - otherwise a live (uncleared, non-bailed) pr-tracker entry folds onto the
   *    display state when the actor merely rests in a waiting state
   *    (`awaiting-ci` / `in-progress` / `working`). This surfaces an unresolved
   *    failure even when `fixCi` / `fixConflicts` is off and the scan never sent
   *    a `*_DETECTED` event — the case that motivated this board. The pr-tracker
   *    entry is a reliable "still broken" signal because the scan clears it the
   *    moment the PR becomes mergeable.
   *
   * `done` / disposed tickets are excluded — `done` is a transient glyph, not a
   * resting row.
   */
  private async buildBoard(args: {
    todo: TrackedIssue[];
    inProgress: TrackedIssue[];
    mentions: { issue: TrackedIssue; trigger: MentionTrigger }[];
    prByIssue: Map<string, { url: string; status: PrStatusBucket }>;
    /** Issue ids claimed by the awaiting-confirmation feature. They are
     *  surfaced by the dedicated gated card, so they are excluded here to avoid
     *  double-rendering them as pipeline rows. */
    excludeIds: ReadonlySet<string>;
  }): Promise<TicketRow[]> {
    const { todo, inProgress, mentions, prByIssue, excludeIds } = args;
    type Source = { issue: TrackedIssue; kind: TicketSourceKind; changeName: string };
    const order: Source[] = [
      ...this.workers.map((w) => ({
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
        kind: "in-progress" as const,
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

    const seen = new Set<string>();
    const rows: TicketRow[] = [];
    for (const src of order) {
      if (excludeIds.has(src.issue.id)) continue;
      if (seen.has(src.issue.id)) continue;
      seen.add(src.issue.id);
      const row = await this.resolveBoardRow(src.issue, src.kind, src.changeName, prByIssue);
      if (row) rows.push(row);
    }
    return rows;
  }

  /** Resolve one board row, or `null` when the ticket is done / disposed and
   *  should not occupy a resting row. See {@link buildBoard} for the overlay
   *  rules. */
  private async resolveBoardRow(
    issue: TrackedIssue,
    kind: TicketSourceKind,
    changeName: string,
    prByIssue: Map<string, { url: string; status: PrStatusBucket }>,
  ): Promise<TicketRow | null> {
    const tracker = this.opts.prTracker;
    const entry = tracker?.getEntry(issue.identifier);
    let state: TicketState;
    if (kind === "todo") {
      state = "todo";
    } else if (kind === "mention") {
      state = "review";
    } else {
      const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
      const actor = await this.flowStore.getActor(issue.id, changeDir);
      state = machineStateToTicketState(actor.getSnapshot().value as string);
      if (state === "done") return null;
      if (kind === "queued" && state === "in-progress") state = "queued";
      if (tracker?.isBailed(issue.identifier)) {
        state = "quarantined";
      } else if (
        entry &&
        !entry.bailed &&
        (state === "awaiting-ci" || state === "in-progress" || state === "working")
      ) {
        state = entry.lastReason === "conflicting" ? "conflict-fix" : "ci-fix";
      }
    }

    const recovery: TicketRecovery | undefined = entry
      ? {
          attempts: entry.attempts,
          bailed: entry.bailed ?? false,
          firstFailedAt: entry.firstFailedAt,
          ...(entry.lastReason ? { lastReason: entry.lastReason } : {}),
        }
      : undefined;
    const prUrl = prByIssue.get(issue.id)?.url;
    return {
      changeName,
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      priority: issue.priority,
      state,
      ...(recovery ? { recovery } : {}),
      ...(prUrl ? { prUrl } : {}),
    };
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

      const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
      const actor = await this.flowStore.getActor(issue.id, changeDir);
      const wasAwaiting = actor.getSnapshot().value === "awaiting";

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
        actor.send({ type: "AWAITING_DETECTED" });
        if (changeDir) {
          await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
        }
      } else if (wasAwaiting) {
        actor.send({ type: "CONFIRMATION_CLEARED" });
        if (changeDir) {
          await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
        }
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
  private async maybePromoteFinishedConflicted(issue: TrackedIssue): Promise<boolean> {
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

    // RLF-97: honor the same recovery gates as `scanPrMergeStates` at this
    // second detection site. Without these, a non-awaiting-ci in-progress
    // ticket whose PR goes red would still spawn a fix worker even when
    // recovery (or the matching toggle) is off — so "off" would not mean off.
    // Returning false lets the ticket fall through to the normal resume path.
    if (!this.opts.prRecovery?.enabled) return false;
    if (pr.status === "conflicted" && !this.opts.prRecovery.fixConflicts) return false;
    if (pr.status === "ci_failed" && !this.opts.prRecovery.fixCi) return false;

    const stateLabel = pr.status === "conflicted" ? "conflicting with main" : "failing CI";

    if (this.conflictPromoted.has(issue.id)) return true;

    // Dispatch to flow actor: ensure actor is in working before sending the
    // conflict/ci event (it might be idle on fresh restart without a snapshot).
    const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
    const actor = await this.flowStore.getActor(issue.id, changeDir);
    if (actor.getSnapshot().value === "idle") {
      actor.send({ type: "RESUME_DETECTED" });
    }
    if (pr.status === "conflicted") {
      actor.send({ type: "CONFLICT_DETECTED" });
    } else {
      actor.send({ type: "CI_FAILED_DETECTED" });
    }

    const trigger: QueueTrigger = pr.status === "conflicted" ? "conflict-fix" : "ci-fix";

    if (changeDir) {
      await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
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

    if (this.opts.postComments !== false) {
      const prNum = extractPrNumber(pr.url);
      const ref = prNum !== null ? `PR #${prNum}` : `PR ${pr.url}`;
      try {
        await this.deps.postComment(
          issue,
          buildRalphyComment({
            type: "promoted",
            action: `promoted to ${trigger} flow`,
            body: `${ref} is ${stateLabel} — promoted to ${trigger} flow.`,
            fields: { trigger, pr: extractPrNumber(pr.url) ?? pr.url },
          }),
        );
        this.deps.onLog(`  ${issue.identifier}: posted ${trigger}-promotion comment`, "gray");
      } catch (err) {
        this.deps.onLog(
          `! Linear ${trigger}-promotion comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    this.conflictPromoted.add(issue.id);
    if (pr.status === "conflicted") this.conflictNotified.add(issue.id);
    else this.ciFailedNotified.add(issue.id);

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
  private async syncWorkerTasks(): Promise<void> {
    if (!this.deps.syncTasks || !this.deps.getIterationCount) return;
    for (const w of this.workers) {
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

  /**
   * For every done-candidate ticket (status=setDone with an open PR),
   * read the PR's merge + CI state from GitHub. Conflicting and CI-red
   * PRs are queued for re-fix runs (`conflict-fix` / `ci-fix`). The
   * in-memory `conflictNotified` / `ciFailedNotified` sets dedup across
   * polls — Linear labels are no longer involved in the routing.
   */
  private async scanPrMergeStates(): Promise<{
    counts: PrStatusCounts;
    /** Per-issue PR url + status discovered this scan, keyed by issue.id.
     *  Reuses the `checkPrStatus` calls already made — no new `gh` calls — so
     *  the board can surface a `↗#NNN` link on parked rows. Only the scanned
     *  candidates are present (active / queued / pending issues are skipped). */
    prByIssue: Map<string, { url: string; status: PrStatusBucket }>;
  }> {
    const counts = emptyPrStatus();
    const prByIssue = new Map<string, { url: string; status: PrStatusBucket }>();
    // RLF-97: `prRecovery.enabled: false` turns recovery off everywhere. Without
    // this gate the scan re-queued conflict-fix / ci-fix workers regardless of
    // the setting (only the bail counter was gated) — so "off" never meant off.
    if (!this.opts.prRecovery?.enabled) return { counts, prByIssue };
    let candidates: TrackedIssue[] = [];
    try {
      candidates = await this.deps.fetchDoneCandidates();
    } catch (err) {
      this.deps.onLog(`! PR merge-state scan fetch failed: ${(err as Error).message}`, "yellow");
      return { counts, prByIssue };
    }
    if (candidates.length === 0) return { counts, prByIssue };

    // Snapshot pre-existing fix workers so the tail loop only counts items
    // that were already queued/active before this scan — newly pushed items
    // are already counted via the per-issue bucket increment below.
    const preQueue = this.queue.map((q) => ({ id: q.issue.id, trigger: q.trigger }));
    const preWorkers = this.workers.map((w) => ({ id: w.issueId, trigger: w.trigger }));

    const tracker = this.opts.prTracker;
    for (const issue of candidates) {
      if (this.workers.some((w) => w.issueId === issue.id)) continue;
      if (this.pendingIds.has(issue.id)) continue;
      if (this.queue.some((q) => q.issue.id === issue.id)) continue;

      // pr-tracker retry (fix): a human cleared the `setError` quarantine label
      // to ask for a retry. Clear the bail so the merge-state scan re-engages
      // conflict/CI recovery instead of skipping it forever. Without this, a bail
      // only ever cleared when the PR became mergeable — which a conflicting PR
      // can never reach on its own — so the ticket was stuck. Non-looping: a
      // subsequent re-bail re-applies setError, so it won't reset again until a
      // human clears the label once more.
      if (tracker?.isBailed(issue.identifier) && this.errorMarkerCleared(issue)) {
        await tracker.clear(issue.identifier).catch(() => {});
        this.conflictNotified.delete(issue.id);
        this.ciFailedNotified.delete(issue.id);
        this.conflictPromoted.delete(issue.id);
        this.deps.onLog(
          `  ${issue.identifier}: pr-tracker bail cleared (ticket back in Todo) — retrying recovery`,
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
      // board surfaces a link even when `fixCi` / `fixConflicts` is off and the
      // scan otherwise `continue`s past this PR without queueing recovery.
      prByIssue.set(issue.id, pr);
      if (pr.status === "mergeable") counts.mergeable += 1;
      // conflicted/ci_failed counts are accumulated via the queue/worker loops below

      // pr-tracker (RLF-173): mergeable PR clears any prior recovery
      // counter so a future regression starts fresh.
      if (pr.status === "mergeable" && this.opts.prTracker) {
        try {
          await this.opts.prTracker.clear(issue.identifier);
        } catch (err) {
          this.deps.onLog(
            `! pr-tracker clear failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
      }

      // RLF-97: a mergeable PR (CI green, no conflicts) is the "PR passed"
      // signal — advance the in-review ticket to done. We only advance tickets
      // whose flow actor rests in `awaiting-ci` — i.e. the worker opened the PR
      // and deferred `setDone` to here. A ticket already moved to done (immediate
      // path, or a prior advance) has a disposed/idle/done actor and is left
      // alone, so the watcher never re-fires `setDone` on a healthy Done ticket.
      // The scan only runs when `prRecovery.enabled` (early return above), so
      // advancement is implicitly gated on enabled and is independent of
      // `fixConflicts` / `fixCi`, which gate recovery only.
      if (pr.status === "mergeable") {
        const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
        const actor = await this.flowStore.getActor(issue.id, changeDir);
        if ((actor.getSnapshot().value as string) === "awaiting-ci") {
          if (this.issueInSetDoneState(issue)) {
            // The ticket is already in the setDone state but its actor rests in
            // awaiting-ci — e.g. an already-Done ticket whose discovered PR was
            // conflict-fixed and is now mergeable again. Re-applying setDone here
            // would post a spurious "moving to done" comment, so just settle the
            // actor to done without re-applying the indicator.
            actor.send({ type: "PR_PASSED" });
            if (changeDir) await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
            if ((actor.getSnapshot().value as string) === "done") {
              this.flowStore.disposeActor(issue.id);
            }
          } else {
            await this.advancePrToDone(issue, pr.url, actor, changeDir);
          }
        }
        continue;
      }

      if (pr.status === "conflicted") {
        // RLF-97: conflict recovery is gated on `prRecovery.fixConflicts`. When
        // off, leave the conflicting PR for a human — no queue, no bail, no
        // count (the watcher still advances it once a human resolves the
        // conflict and it becomes mergeable). Mirrors the `fixCi` gate below.
        if (!this.opts.prRecovery?.fixConflicts) continue;
        // Standing level (fix): count every currently-conflicting PR each scan,
        // not just freshly-detected ones, so the counter reflects reality rather
        // than a one-poll delta. Bailed PRs are surfaced as `quarantined`.
        if (tracker?.isBailed(issue.identifier)) {
          counts.quarantined += 1;
          continue;
        }
        counts.conflicted += 1;
        if (this.conflictNotified.has(issue.id)) continue; // already queued; counted above
        if (await this.prTrackerBail(issue, pr.url, "conflicting")) {
          // This detection just tipped the ticket into bail — reclassify it
          // from "Ralph is recovering" to "needs a human".
          counts.conflicted -= 1;
          counts.quarantined += 1;
          continue;
        }
        emitCapture(this.bus, "agent_conflict_detected", { issue_identifier: issue.identifier });
        this.conflictNotified.add(issue.id);
        this.deps.onLog(
          `  ${issue.identifier}: PR ${pr.url} conflicting — queued (conflict-fix)`,
          "yellow",
        );
        if (this.opts.postComments !== false) {
          try {
            await this.deps.postComment(
              issue,
              buildRalphyComment({
                type: "conflict-detected",
                action: "detected merge conflicts",
                body: `Detected merge conflicts on this PR (${pr.url}) — re-running to resolve.`,
                fields: { pr: extractPrNumber(pr.url) ?? pr.url },
              }),
            );
          } catch (err) {
            this.deps.onLog(
              `! Linear conflict comment failed for ${issue.identifier}: ${(err as Error).message}`,
              "yellow",
            );
          }
        }
        const conflictActor = await this.flowStore.getActor(
          issue.id,
          this.deps.getChangeDir?.(issue) ?? undefined,
        );
        conflictActor.send({ type: "RESUME_DETECTED" });
        conflictActor.send({ type: "CONFLICT_DETECTED" });
        this.queue.push({
          issue,
          trigger: "conflict-fix",
          priority: defaultPriorityFor("conflict-fix"),
        });
        // (counts.conflicted already incremented above as a standing level)
        continue;
      }

      if (pr.status === "ci_failed") {
        // RLF-97: CI recovery is gated on `prRecovery.fixCi`. When off, leave a
        // CI-red PR alone (conflict recovery still runs above) — no queue, no
        // bail, no count. A human owns the failing checks.
        if (!this.opts.prRecovery?.fixCi) continue;
        // Standing level + quarantine surfacing (fix) — mirrors conflicted above.
        if (tracker?.isBailed(issue.identifier)) {
          counts.quarantined += 1;
          continue;
        }
        counts.ciFailed += 1;
        if (this.ciFailedNotified.has(issue.id)) continue; // already queued; counted above
        if (await this.prTrackerBail(issue, pr.url, "ci_failed")) {
          counts.ciFailed -= 1;
          counts.quarantined += 1;
          continue;
        }
        emitCapture(this.bus, "agent_ci_failed_detected", { issue_identifier: issue.identifier });
        this.ciFailedNotified.add(issue.id);
        this.deps.onLog(
          `  ${issue.identifier}: PR ${pr.url} CI failing — queued (ci-fix)`,
          "yellow",
        );
        if (this.opts.postComments !== false) {
          try {
            await this.deps.postComment(
              issue,
              buildRalphyComment({
                type: "ci-failed",
                action: "detected failing CI",
                body: `Detected failing CI on this PR (${pr.url}) — re-running to fix.`,
                fields: { pr: extractPrNumber(pr.url) ?? pr.url },
              }),
            );
          } catch (err) {
            this.deps.onLog(
              `! Linear ci-failed comment failed for ${issue.identifier}: ${(err as Error).message}`,
              "yellow",
            );
          }
        }
        const ciActor = await this.flowStore.getActor(
          issue.id,
          this.deps.getChangeDir?.(issue) ?? undefined,
        );
        ciActor.send({ type: "RESUME_DETECTED" });
        ciActor.send({ type: "CI_FAILED_DETECTED" });
        this.queue.push({
          issue,
          trigger: "ci-fix",
          priority: defaultPriorityFor("ci-fix"),
        });
        // (counts.ciFailed already incremented above as a standing level)
      }
    }

    // Issues already queued or running for conflict-fix / ci-fix were detected
    // in a prior scan and skipped above — add them so the counter stays accurate.
    // Use the pre-scan snapshot to avoid double-counting items pushed in this scan.
    for (const q of preQueue) {
      if (q.trigger === "conflict-fix") counts.conflicted += 1;
      else if (q.trigger === "ci-fix") counts.ciFailed += 1;
    }
    for (const w of preWorkers) {
      if (w.trigger === "conflict-fix") counts.conflicted += 1;
      else if (w.trigger === "ci-fix") counts.ciFailed += 1;
    }

    return { counts, prByIssue };
  }

  /**
   * RLF-97: advance an in-review ticket to done after its PR became mergeable.
   * The worker deferred `setDone` to the watcher (see `notifyExited`), so this
   * is where the move-to-done actually happens: apply `setDone`, clear the
   * in-progress label, then drive the flow actor `awaiting-ci` → done and
   * dispose it. `setDone` is applied BEFORE the actor transition so that if the
   * Linear write throws the actor stays in `awaiting-ci` and the next scan
   * retries the advance. Caller guarantees `actor` is in `awaiting-ci`.
   */
  /** True when the issue already carries the `setDone` marker(s) — i.e. it is
   *  already in the done state (status and/or label). Used to suppress a
   *  redundant advance-to-done on a ticket that reached done by another path. */
  private issueInSetDoneState(issue: TrackedIssue): boolean {
    const sd = this.opts.setDone;
    if (!sd) return false;
    return issueMatchesGetIndicator(issue, { filter: markersOf(sd) });
  }

  private async advancePrToDone(
    issue: TrackedIssue,
    prUrl: string,
    actor: Awaited<ReturnType<typeof this.flowStore.getActor>>,
    changeDir: string | undefined,
  ): Promise<void> {
    this.deps.onLog(`  ${issue.identifier}: PR ${prUrl} mergeable — moving to done`, "green");

    if (this.opts.setDone) {
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
        // Leave the actor in `awaiting-ci` so the next scan retries the advance.
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

    actor.send({ type: "PR_PASSED" });
    if (changeDir) {
      await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
    }
    if ((actor.getSnapshot().value as string) === "done") {
      this.flowStore.disposeActor(issue.id);
    }

    if (this.opts.postComments !== false) {
      try {
        await this.deps.postComment(
          issue,
          buildRalphyComment({
            type: "verified",
            action: "verified PR mergeable",
            body: `Verified this PR (${prUrl}) is mergeable (CI green, no conflicts) — moving to done.`,
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

  /**
   * pr-tracker gate (RLF-173). Returns `true` when the caller should
   * SKIP queueing the recovery worker — either because the issue is
   * already bailed, or because this detection just tipped it over the
   * `maxRecoveryAttempts` threshold (in which case `setError` is applied
   * and a Linear comment is posted exactly once). Returns `false` when
   * the caller should proceed with its normal demote-to-queue path.
   *
   * Falls back to "proceed" (returns false) when no tracker is wired or
   * when the tracker itself throws — the legacy behavior should never
   * regress on tracker failures.
   */
  /** True when `setError` is configured (a quarantine label) but the issue no
   *  longer carries it — i.e. a human cleared the label to request a retry.
   *  Used to release a pr-tracker bail. Returns false when no label-type
   *  setError is configured (then a bail only clears on a mergeable PR). */
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

  private async prTrackerBail(
    issue: TrackedIssue,
    prUrl: string,
    reason: "conflicting" | "ci_failed",
  ): Promise<boolean> {
    const tracker = this.opts.prTracker;
    if (!tracker) return false;
    let decision: Awaited<ReturnType<typeof tracker.recordFailure>>;
    try {
      decision = await tracker.recordFailure(issue.identifier, reason);
    } catch (err) {
      this.deps.onLog(
        `! pr-tracker record failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      return false;
    }
    if (decision.kind === "demote") return false;

    if (decision.firstBail) {
      this.deps.onLog(
        `  ${issue.identifier}: pr-tracker bailing after ${decision.attempts} recovery attempts (${reason}) — applying setError`,
        "red",
      );
      emitCapture(this.bus, "agent_pr_tracker_bailed", {
        issue_identifier: issue.identifier,
        reason,
        attempts: decision.attempts,
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
              body: `Gave up auto-recovering this PR (${prUrl}) after ${decision.attempts} attempts — last failure: ${human}. The \`ralph:error\` label has been applied; clear it (or merge the PR) once a human has looked at it.`,
              fields: { pr: extractPrNumber(prUrl) ?? prUrl, attempts: decision.attempts },
            }),
          );
        } catch (err) {
          this.deps.onLog(
            `! Linear bail comment failed for ${issue.identifier}: ${(err as Error).message}`,
            "yellow",
          );
        }
      }
    }
    return true;
  }

  spawnNext(): void {
    if (this.stopped) return;
    while (
      this.workers.length + this.pendingIds.size < this.opts.concurrency &&
      this.queue.length > 0
    ) {
      const next = this.queue.shift()!;
      this.pendingIds.add(next.issue.id);
      this.track(this.launchWorker(next.issue, next.trigger, next.mention));
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
   * loop until none remain. Test-only seam: `spawnNext` launches workers
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
      // Let any continuation scheduled by the work we just awaited register.
      // A worker's finalization enrolls lazily — `handle.exited.then(...)`
      // only adds the finalize continuation to `inFlight` *after* the exit
      // promise resolves, and under CI load that resolve→enroll chain can
      // span more than one macrotask hop. Require the set to stay empty
      // across `WHEN_SETTLED_STABLE_HOPS` consecutive hops before concluding
      // idle so a pending enrollment lands, re-fills `inFlight`, and resets
      // the counter. Never hangs on a still-running worker.
      await new Promise<void>((r) => setTimeout(r, 0));
      if (this.inFlight.size === 0) {
        consecutiveEmpty += 1;
        if (consecutiveEmpty >= WHEN_SETTLED_STABLE_HOPS) return;
      } else {
        consecutiveEmpty = 0;
      }
    }
  }

  private async launchWorker(
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
      emitCapture(this.bus, "agent_prepare_failed", {
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
    if (trigger !== "resume" && this.opts.setInProgress) {
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
    this.workers.push(worker);
    this.pendingIds.delete(issue.id);

    // Notify the flow actor that a worker has been spawned so it can track the handle
    const spawnedActor = this.flowStore.peekActor(issue.id);
    if (spawnedActor) {
      const flowWorker = {
        exited: handle.exited as Promise<number | null>,
        kill: (_signal?: "SIGTERM" | "SIGKILL") => handle.kill(),
      };
      const assignment: FlowAssignment = {
        flowId: triggerToFlowId(trigger),
        reason: `started via ${trigger}`,
        boost: "p2" as const,
      };
      spawnedActor.send({ type: "WORKER_SPAWNED", worker: flowWorker, assignment });
    }
    this.ticketsStarted += 1;
    const maxT = this.opts.maxTickets ?? 0;
    if (maxT > 0 && this.ticketsStarted >= maxT) {
      this.deps.onLog(
        `  ticket limit reached (${maxT}) — no new issues will be picked up`,
        "yellow",
      );
    }
    emitCapture(this.bus, "agent_worker_spawned", {
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
    {
      const idx = this.workers.indexOf(worker);
      if (idx >= 0) this.workers.splice(idx, 1);
      if (worker.restarting) {
        // Steering-driven restart — do not finalize the issue. Re-queue
        // the same issue as a resume so the next iteration picks up the
        // steering note we just appended.
        this.ticketsStarted = Math.max(0, this.ticketsStarted - 1);
        this.queue.unshift({
          issue,
          trigger: "resume",
          priority: defaultPriorityFor("resume"),
        });
        this.deps.onWorkersChanged();
        this.spawnNext();
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
        this.deps.onLog(
          `  ${issue.identifier}: worker reaped (awaiting human confirmation)`,
          "gray",
        );
        this.deps.onWorkersChanged();
        this.spawnNext();
        return;
      }
      const ok = code === 0 || code === NO_CHANGES_EXIT;
      this.deps.onLog(
        `${ok ? "✓" : "✗"} ${issue.identifier} → ${prep.changeName} exited (code ${code})`,
        ok ? "green" : "red",
      );
      emitCapture(this.bus, "agent_worker_exited", {
        spawn_mode: trigger,
        issue_identifier: issue.identifier,
        exit_code: code,
        ok,
      });
      await this.notifyExited(issue, prep.changeName, code, trigger, worker.cwd);
      this.deps.onWorkersChanged();
      this.spawnNext();
    }
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
    // Notify the flow actor to preempt the current worker and transition to awaiting
    const reapActor = this.flowStore.peekActor(worker.issueId);
    if (reapActor) {
      const awaitingAssignment: FlowAssignment = {
        flowId: "confirmation",
        reason: "awaiting human confirmation",
        boost: "p2" as const,
      };
      reapActor.send({ type: "PREEMPT", newAssignment: awaitingAssignment });
    }
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

    // Dispatch to flow actor based on exit code
    const changeDir = this.deps.getChangeDir?.(issue) ?? undefined;
    const exitActor = await this.flowStore.getActor(issue.id, changeDir);
    exitActor.send({ type: !ok ? "WORKER_FAILED" : deferDone ? "PR_OPENED" : "WORKER_SUCCEEDED" });
    if (changeDir) {
      await this.flowStore.persistActor(issue.id, changeDir).catch(() => {});
    }
    const exitActorState = exitActor.getSnapshot().value as string;
    if (exitActorState === "done" || exitActorState === "error") {
      this.flowStore.disposeActor(issue.id);
    }
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
      const body = completionCommentBody({ noChanges, ok, trigger, changeName, code });
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
      // Conflict-fix / ci-fix success: the worker iteration drove the
      // re-fix; the coordinator just re-arms the gh-driven scan so the
      // next poll re-evaluates the PR state from scratch.
      if (trigger === "conflict-fix") {
        this.conflictNotified.delete(issue.id);
        this.conflictPromoted.delete(issue.id);
      } else if (trigger === "ci-fix") {
        this.ciFailedNotified.delete(issue.id);
        this.conflictPromoted.delete(issue.id);
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

import type { BoostBand } from "./types";

function triggerToFlowId(trigger: QueueTrigger): FlowId {
  if (trigger === "conflict-fix") return "conflict-fix";
  if (trigger === "ci-fix") return "ci-fix";
  if (trigger === "review") return "review-followup";
  return "implement";
}

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
