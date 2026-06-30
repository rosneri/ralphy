import { fromPromise } from "xstate";
import type {
  DetectionEvent,
  FailureReason,
  FlowContext,
  FlowData,
  PreemptActorInput,
  RecoveryNotifiedEvent,
} from "./flow-machine-types";

/**
 * Preemption protocol (8 steps):
 *   1. emit runtime.preempt.started
 *   2. SIGTERM (skipped when worker is undefined)
 *   3. wait up to graceMs for exit (skipped when worker is undefined)
 *   4. SIGKILL if still alive (skipped when worker is undefined)
 *   5. await exit (skipped when worker is undefined)
 *   6. teardown("cancelled") — errors swallowed
 *   7. persist new assignment
 *   8. emit runtime.preempt.completed
 */
export const preemptionActorLogic = fromPromise<void, PreemptActorInput>(async ({ input }) => {
  const { worker, graceMs, teardown, persist, issueId, newAssignment, bus } = input;

  bus.emit({
    type: "runtime.preempt.started",
    issueId,
    from: input.from ?? null,
    to: newAssignment.flowId,
  });

  if (worker !== undefined) {
    try {
      worker.kill("SIGTERM");
    } catch {
      /* worker may already be dead */
    }

    const exited = await Promise.race([
      worker.exited.then(() => "exited" as const),
      new Promise<"timeout">((resolve) => {
        const t = setTimeout(() => resolve("timeout"), graceMs);
        t.unref();
      }),
    ]);

    if (exited === "timeout") {
      try {
        worker.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      await worker.exited;
    }
  }

  if (teardown) {
    try {
      await teardown("cancelled");
    } catch {
      /* swallowed — teardown errors must not block preemption */
    }
  }

  await persist(issueId, newAssignment);

  bus.emit({ type: "runtime.preempt.completed", issueId, to: newAssignment.flowId });
});

/**
 * `assign` updater for a fresh failure detection: bump `attempts`, set
 * `lastReason`, and seed `firstFailedAt` once (first detection wins). The
 * notification timestamps are carried over — a re-detection within the same
 * unresolved session must not re-arm the comment dedup.
 */
export function recordDetection(reason: FailureReason) {
  return ({
    context,
    event,
  }: {
    context: FlowContext;
    event: DetectionEvent;
  }): { data: FlowData } => {
    const previous = context.data.recovery;
    return {
      data: {
        ...context.data,
        recovery: {
          ...previous,
          attempts: (previous?.attempts ?? 0) + 1,
          lastReason: reason,
          firstFailedAt: previous?.firstFailedAt ?? event.at ?? "",
          prUrl: event.prUrl ?? previous?.prUrl ?? "",
        },
      },
    };
  };
}

/** `assign` updater for `RECOVERY_NOTIFIED`: stamp the matching `*NotifiedAt`
 *  field. A notification with no prior recovery record (defensive — should not
 *  happen) seeds an empty one so the fact is still not lost. */
export function recordNotification({
  context,
  event,
}: {
  context: FlowContext;
  event: RecoveryNotifiedEvent;
}): { data: FlowData } {
  const previous = context.data.recovery ?? {
    attempts: 0,
    lastReason: "ci_failed" as FailureReason,
    firstFailedAt: "",
    prUrl: "",
  };
  const field =
    event.kind === "detection"
      ? "detectionNotifiedAt"
      : event.kind === "promotion"
        ? "promotionNotifiedAt"
        : "bailNotifiedAt";
  return {
    data: { ...context.data, recovery: { ...previous, [field]: event.at } },
  };
}

/** `assign` updater clearing the detection / promotion notification stamps
 *  when a fix worker succeeds — the session resolved, so the next genuine red
 *  re-notifies. Attempts / firstFailedAt persist until `RECOVERY_CLEARED`. */
export function clearSessionNotifications({ context }: { context: FlowContext }): {
  data: FlowData;
} {
  const previous = context.data.recovery;
  if (!previous) return { data: context.data };
  const { detectionNotifiedAt: _d, promotionNotifiedAt: _p, ...rest } = previous;
  return { data: { ...context.data, recovery: rest } };
}

/** Guard: this detection tips the ticket over the quarantine threshold. A
 *  threshold of `0` (unconfigured) disables quarantine entirely. */
export function reachesQuarantine({ context }: { context: FlowContext }): boolean {
  const max = context.data.maxRecoveryAttempts;
  return max > 0 && (context.data.recovery?.attempts ?? 0) + 1 >= max;
}

/** `assign` updater for a re-detection while already quarantined: refresh the
 *  reason without re-counting (mirrors the old tracker's post-bail behavior). */
export function refreshReason(reason: FailureReason) {
  return ({
    context,
    event,
  }: {
    context: FlowContext;
    event: DetectionEvent;
  }): {
    data: FlowData;
  } => {
    const previous = context.data.recovery;
    return {
      data: {
        ...context.data,
        recovery: previous
          ? { ...previous, lastReason: reason, prUrl: event.prUrl ?? previous.prUrl }
          : { attempts: 0, lastReason: reason, firstFailedAt: "", prUrl: event.prUrl ?? "" },
      },
    };
  };
}

/** `assign` updater that drops the recovery record — the PR is healthy again
 *  (mergeable) or the human cleared the quarantine. Mirrors the old
 *  `PrTracker.clear`. */
export function clearRecovery({ context }: { context: FlowContext }): { data: FlowData } {
  return { data: { ...context.data, recovery: undefined } };
}
