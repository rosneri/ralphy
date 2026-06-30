/**
 * RFC #402 — the worker spawn→exit→finalize pipeline extracted from
 * {@link WorkerPool} as free helpers. Each helper takes an explicit
 * {@link WorkerSpawnContext} carrying the exact pool state and seams the
 * method bodies relied on (the dependency/option bundles, the pending and
 * active sets, the ticket counter accessors, the in-flight tracker, and the
 * fill loop), so the class methods become thin delegators while behavior is
 * preserved one-for-one.
 */
import type { TrackedIssue } from "@ralphy/tracker";
import type { FlowAssignment } from "@ralphy/core/machines";
import { buildRalphyComment, isStartedComment } from "@ralphy/comms";
import { WORKER_EXIT_CODES } from "@ralphy/types";
import {
  defaultPriorityFor,
  type MentionTrigger,
  type QueueTrigger,
} from "../../queue/queue-order";
import type { ActiveWorker } from "../types";
import { emitCapture } from "./telemetry";
import {
  completionCommentBody,
  triggerToFlowId,
  type PrepareResult,
  type WorkerPoolDeps,
  type WorkerPoolOpts,
} from "./worker-pool-support";

/** The exact pool state the spawn/exit/finalize helpers mutate and read.
 *  The class hands a single instance of this in so the helpers operate on the
 *  live pool without re-deriving any value. `pendingIds` and `workersList`
 *  are the pool's own references (mutated in place); the ticket counter is a
 *  primitive, so it is read and written through accessors. */
export interface WorkerSpawnContext {
  readonly deps: WorkerPoolDeps;
  readonly opts: WorkerPoolOpts;
  isStopped: () => boolean;
  readonly pendingIds: Set<string>;
  readonly workersList: ActiveWorker[];
  getTicketsStarted: () => number;
  setTicketsStarted: (value: number) => void;
  track: (promise: Promise<unknown>) => void;
  fill: () => void;
}

export async function launchWorker(
  context: WorkerSpawnContext,
  issue: TrackedIssue,
  trigger: QueueTrigger,
  mention?: MentionTrigger,
): Promise<void> {
  let prep: PrepareResult;
  try {
    prep = await context.deps.prepare(issue);
    if (
      (trigger === "conflict-fix" || trigger === "ci-fix" || trigger === "review") &&
      context.deps.prepareTaskForTrigger
    ) {
      await context.deps.prepareTaskForTrigger(issue, prep.changeName, trigger, mention);
    }
  } catch (err) {
    context.pendingIds.delete(issue.id);
    context.deps.onLog(
      `! prepare(${trigger}) failed for ${issue.identifier}: ${(err as Error).message}`,
      "red",
    );
    emitCapture(context.deps.bus, "agent_prepare_failed", {
      spawn_mode: trigger,
      issue_identifier: issue.identifier,
      error: (err as Error).message,
    });
    // Quarantine: prepare failure (most often a worktree creation
    // failure) is the only signal the user has that the issue can't be
    // picked up. Apply `setError` so the ticket is filtered out of the
    // todo bucket and the human can investigate.
    if (context.opts.setError) {
      try {
        await context.deps.applyIndicator(issue, context.opts.setError);
        context.deps.onLog(`  ${issue.identifier}: setError applied`, "gray");
      } catch (markErr) {
        context.deps.onLog(
          `! Linear setError failed for ${issue.identifier}: ${(markErr as Error).message}`,
          "yellow",
        );
      }
    }
    context.fill();
    return;
  }

  if (context.isStopped()) {
    context.pendingIds.delete(issue.id);
    return;
  }

  // Apply setInProgress BEFORE spawning so a same-second re-poll doesn't
  // see the issue as still-todo. Skip for resume (already in progress).
  // Conflict-fix and review modes also apply it so the issue moves out
  // of its prior status (done/conflicted) immediately on pickup.
  if (trigger !== "resume" && context.opts.setInProgress) {
    try {
      await context.deps.applyIndicator(issue, context.opts.setInProgress);
      context.deps.onLog(`  ${issue.identifier}: setInProgress applied`, "gray");
    } catch (err) {
      context.deps.onLog(
        `! Linear setInProgress failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
      emitCapture(context.deps.bus, "agent_indicator_failed", {
        indicator: "setInProgress",
        issue_identifier: issue.identifier,
        error: (err as Error).message,
      });
    }
  }

  if (trigger === "review" && context.opts.postComments !== false) {
    const sourceTag = mention
      ? mention.source === "github"
        ? " (GitHub @mention)"
        : mention.source === "github-review"
          ? " (GitHub code review)"
          : " (Linear @mention)"
      : "";
    try {
      await context.deps.postComment(
        issue,
        buildRalphyComment({
          type: "review-pickup",
          action: "picked up review comments",
          body: `Picked up new review comments${sourceTag}. Tracking change: \`${prep.changeName}\``,
          fields: { change: prep.changeName },
        }),
      );
    } catch (err) {
      context.deps.onLog(
        `! Linear review comment failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }

  // Post the "started" comment idempotently — only on fresh, and only if
  // we haven't already posted one (resume-detection via comment scan).
  if (trigger === "fresh" && context.opts.postComments !== false) {
    let alreadyPosted = false;
    try {
      const comments = await context.deps.fetchComments(issue.id);
      alreadyPosted = comments.some((c) => isStartedComment(c.body));
    } catch (err) {
      context.deps.onLog(
        `! Linear comment fetch failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
    if (!alreadyPosted) {
      try {
        await context.deps.postComment(
          issue,
          buildRalphyComment({
            type: "started",
            action: "started working",
            body: `Tracking change: \`${prep.changeName}\``,
            fields: { change: prep.changeName },
          }),
        );
        context.deps.onLog(`  ${issue.identifier}: posted "started" comment`, "gray");
      } catch (err) {
        context.deps.onLog(
          `! Linear comment failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
      }
    }
  }

  context.deps.onLog(
    `▶ ${issue.identifier} → ${prep.changeName} (${trigger})`,
    trigger === "conflict-fix" ? "yellow" : "cyan",
  );
  const handle = context.deps.spawnWorker(prep.changeName, issue, trigger);
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
  context.workersList.push(worker);
  context.pendingIds.delete(issue.id);

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
  context.deps.director.dispatchLoaded(issue.id, {
    type: "WORKER_SPAWNED",
    worker: flowWorker,
    assignment,
  });
  context.setTicketsStarted(context.getTicketsStarted() + 1);
  const maxT = context.opts.maxTickets ?? 0;
  if (maxT > 0 && context.getTicketsStarted() >= maxT) {
    context.deps.onLog(
      `  ticket limit reached (${maxT}) — no new issues will be picked up`,
      "yellow",
    );
  }
  emitCapture(context.deps.bus, "agent_worker_spawned", {
    spawn_mode: trigger,
    issue_identifier: issue.identifier,
  });
  context.deps.onWorkersChanged();

  if (context.deps.syncTasks) {
    try {
      await context.deps.syncTasks(worker, 0);
    } catch (err) {
      context.deps.onLog(
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
    context.track(finalizeWorkerExit(context, worker, issue, prep, trigger, code)),
  );
}

/** The post-exit finalization continuation, extracted so it can be
 *  tracked by `whenSettled`. Mutates worker bookkeeping, finalizes
 *  the issue (or re-queues on restart/reap), and kicks the next spawn. */
export async function finalizeWorkerExit(
  context: WorkerSpawnContext,
  worker: ActiveWorker,
  issue: TrackedIssue,
  prep: PrepareResult,
  trigger: QueueTrigger,
  code: number,
): Promise<void> {
  const idx = context.workersList.indexOf(worker);
  if (idx >= 0) context.workersList.splice(idx, 1);
  if (worker.restarting) {
    // Steering-driven restart — do not finalize the issue. Re-queue
    // the same issue as a resume so the next iteration picks up the
    // steering note we just appended.
    context.setTicketsStarted(Math.max(0, context.getTicketsStarted() - 1));
    context.deps.requeueFront({
      issue,
      trigger: "resume",
      priority: defaultPriorityFor("resume"),
    });
    context.deps.onWorkersChanged();
    context.fill();
    return;
  }
  if (worker.reapedForAwaiting) {
    // Ticket flipped into awaiting-confirmation while this worker was
    // running. Do not finalize the issue (no setError/setDone). A
    // future poll will re-classify and resume after approval/revise.
    context.setTicketsStarted(Math.max(0, context.getTicketsStarted() - 1));
    // Flush a final syncTasks pass so spec-attachments picks up the
    // proposal.md / design.md / tasks.md that the worker just wrote.
    // Without this, a planning-only worker (LIT-303 case) that
    // finishes inside iteration 0 leaves Linear with no design PDF —
    // the poll loop's `count === lastSyncedIteration` guard skips
    // every subsequent tick.
    if (context.deps.syncTasks) {
      let iteration = 0;
      if (context.deps.getIterationCount) {
        try {
          iteration = await context.deps.getIterationCount(worker.changeName);
        } catch {
          iteration = 0;
        }
      }
      try {
        await context.deps.syncTasks(worker, iteration);
      } catch (err) {
        context.deps.onLog(
          `! sync-tasks (awaiting-reap) failed for ${issue.identifier}: ${(err as Error).message}`,
          "yellow",
        );
      }
    }
    context.deps.onLog(
      `  ${issue.identifier}: worker reaped (awaiting human confirmation)`,
      "gray",
    );
    context.deps.onWorkersChanged();
    context.fill();
    return;
  }
  const ok = code === 0 || code === WORKER_EXIT_CODES.noChanges;
  context.deps.onLog(
    `${ok ? "✓" : "✗"} ${issue.identifier} → ${prep.changeName} exited (code ${code})`,
    ok ? "green" : "red",
  );
  emitCapture(context.deps.bus, "agent_worker_exited", {
    spawn_mode: trigger,
    issue_identifier: issue.identifier,
    exit_code: code,
    ok,
  });
  await notifyWorkerExited(
    context.deps,
    context.opts,
    issue,
    prep.changeName,
    code,
    trigger,
    worker.cwd,
  );
  context.deps.onWorkersChanged();
  context.fill();
}

export async function notifyWorkerExited(
  deps: WorkerPoolDeps,
  opts: WorkerPoolOpts,
  issue: TrackedIssue,
  changeName: string,
  code: number,
  trigger: QueueTrigger,
  workerCwd?: string,
): Promise<void> {
  // WORKER_EXIT_CODES.noChanges (no-op: branch only ever touched meta files,
  // work already on base) is finalized as a success — done with an honest
  // comment — not a quarantined failure. Treat it like `ok` for task sync and
  // finalization.
  const noChanges = code === WORKER_EXIT_CODES.noChanges;
  const ok = code === 0 || noChanges;

  // RLF-97: when a normal worker opens a PR and recovery is enabled, the
  // ticket is NOT done yet — it rests in-review and the watcher advances it
  // to done once the PR is mergeable. Defer `setDone` to the watcher and route
  // the actor to `awaiting-ci` (PR_OPENED) instead of `done` (WORKER_SUCCEEDED).
  // Recovery-trigger exits and the recovery-off / no-PR cases keep the
  // immediate-done behavior. `conflict-fix` / `ci-fix` successes route to
  // `awaiting-ci` via the machine's own WORKER_SUCCEEDED transition.
  const isRecoveryTrigger = trigger === "conflict-fix" || trigger === "ci-fix";
  const prOpened = deps.hasPrForChange?.(changeName) ?? false;
  // Defer only for PR-producing runs (`createsPrs`). A non-PR workflow keeps
  // the historical immediate-Done contract even if a stray PR was discovered
  // for the branch; `createsPrs && !prOpened` (no-op / no-commits finalize,
  // exit 70/71) also stays immediate-Done.
  const deferDone =
    ok && !isRecoveryTrigger && !!opts.createsPrs && prOpened && !!opts.prRecovery?.enabled;

  // Dispatch to flow actor based on exit code. A fix-trigger success also
  // clears the session's notification stamps inside the machine, re-arming
  // the gh-driven scan's comment dedup for the next genuine red.
  const exitView = await deps.director.dispatch(deps.flowRef(issue), {
    type: !ok ? "WORKER_FAILED" : deferDone ? "PR_OPENED" : "WORKER_SUCCEEDED",
  });
  const exitActorState = exitView.value;
  deps.director.disposeIfDone(issue.id);
  if (deps.syncTasks && ok) {
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
      if (deps.getIterationCount) {
        try {
          iteration = await deps.getIterationCount(changeName);
        } catch {
          iteration = 0;
        }
      }
      await deps.syncTasks(synthetic, iteration);
    } catch (err) {
      deps.onLog(
        `! sync-tasks (done) failed for ${issue.identifier}: ${(err as Error).message}`,
        "yellow",
      );
    }
  }
  if (opts.postComments !== false) {
    const body = completionCommentBody({
      noChanges,
      ok,
      trigger,
      changeName,
      code,
      reachedDone: exitActorState === "done",
    });
    try {
      await deps.postComment(issue, body);
      deps.onLog(`  ${issue.identifier}: posted completion comment`, "gray");
    } catch (err) {
      deps.onLog(
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
      deps.onLog(
        `  ${issue.identifier}: PR open — deferring setDone to the PR-recovery watcher`,
        "gray",
      );
    } else if (opts.setDone) {
      try {
        await deps.applyIndicator(issue, opts.setDone);
        deps.onLog(`  ${issue.identifier}: setDone applied`, "gray");
      } catch (err) {
        deps.onLog(
          `! Linear setDone failed for ${issue.identifier}: ${(err as Error).message}`,
          "red",
        );
        emitCapture(deps.bus, "agent_indicator_failed", {
          indicator: "setDone",
          issue_identifier: issue.identifier,
          error: (err as Error).message,
        });
      }
      // Remove the in-progress label now that the task is done.
      if (opts.setInProgress) {
        try {
          await deps.removeIndicator(issue, opts.setInProgress);
          deps.onLog(`  ${issue.identifier}: clearInProgress applied`, "gray");
        } catch {
          // non-fatal — label cleanup failure doesn't affect the task outcome
        }
      }
    }
  } else if (opts.setError) {
    try {
      await deps.applyIndicator(issue, opts.setError);
      deps.onLog(`  ${issue.identifier}: setError applied`, "gray");
    } catch (err) {
      deps.onLog(
        `! Linear setError failed for ${issue.identifier}: ${(err as Error).message}`,
        "red",
      );
      emitCapture(deps.bus, "agent_indicator_failed", {
        indicator: "setError",
        issue_identifier: issue.identifier,
        error: (err as Error).message,
      });
    }
    // Remove the in-progress label now that the task has errored.
    if (opts.setInProgress) {
      try {
        await deps.removeIndicator(issue, opts.setInProgress);
        deps.onLog(`  ${issue.identifier}: clearInProgress applied`, "gray");
      } catch {
        // non-fatal
      }
    }
  }
}
