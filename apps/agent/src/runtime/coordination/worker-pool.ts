/**
 * RFC #402 — the worker lifecycle: prepare → spawn → exit → finalize. Owns
 * the active-worker set, the pending-prepare set, the concurrency fill loop,
 * the ticket counter, and the {@link WorkerPool.whenSettled} test barrier.
 * The queue itself stays with the shell — the pool pulls entries through the
 * `dequeue` port and hands restart re-queues back through `requeueFront`.
 *
 * The spawn→exit→finalize bodies live in `worker-pool-internals.ts` as free
 * helpers; the pure shapes, the outcome comment builder, and the dependency /
 * option interfaces live in `worker-pool-support.ts`. The class below holds
 * the live state and delegates into those helpers via {@link WorkerSpawnContext}.
 */
import type { FlowAssignment } from "@ralphy/core/machines";
import type { ActiveWorker } from "../types";
import { emitCapture } from "./telemetry";
import {
  WHEN_SETTLED_STABLE_HOPS,
  type WorkerPoolDeps,
  type WorkerPoolOpts,
} from "./worker-pool-support";
import { launchWorker, type WorkerSpawnContext } from "./worker-pool-internals";

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
  /** Live state + seams handed to the spawn/exit/finalize helpers so they
   *  operate on this pool without re-deriving any value. */
  private readonly spawnContext: WorkerSpawnContext;

  constructor(
    private readonly deps: WorkerPoolDeps,
    private readonly opts: WorkerPoolOpts,
  ) {
    this.spawnContext = {
      deps: this.deps,
      opts: this.opts,
      isStopped: () => this.stopped,
      pendingIds: this.pendingIds,
      workersList: this.workersList,
      getTicketsStarted: () => this.ticketsStarted,
      setTicketsStarted: (value: number) => {
        this.ticketsStarted = value;
      },
      track: (promise: Promise<unknown>) => {
        void this.track(promise);
      },
      fill: () => this.fill(),
    };
  }

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
      this.track(launchWorker(this.spawnContext, next.issue, next.trigger, next.mention));
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
