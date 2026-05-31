import type { Bus } from "@ralphy/events";
import { createNoopBus } from "@ralphy/events";
import { preemptionActorLogic } from "@ralphy/core/machines";
import type { FlowAssignment, FlowId } from "./types";

export { preemptionActorLogic };

/** Flow ids that run as "no-worker" — the slice's `run()` executes
 *  inline (no `Bun.spawn`, no concurrency-slot acquisition). The
 *  coordinator must early-return for these assignments before reaching
 *  the worker spawn path. */
const NO_WORKER_FLOWS: ReadonlySet<FlowId> = new Set<FlowId>(["awaiting-ci"]);

/** Whether the coordinator should spawn a worker subprocess for the
 *  given flow id. False for `awaiting-ci`: the slice only calls
 *  `gh pr checks` via `caps.ciFix.getCiStatus()` and emits one event. */
export function requiresWorker(flowId: FlowId): boolean {
  return !NO_WORKER_FLOWS.has(flowId);
}

/**
 * Minimal worker handle expected by `flow-runner`. Compatible with the
 * shape returned by `Bun.spawn(...)`-driven workers used elsewhere in
 * the agent runtime, but kept narrow so the runner stays unit-testable
 * with fake handles.
 */
export interface FlowWorker {
  /** Resolves with the worker's exit code once the subprocess exits. */
  exited: Promise<number | null>;
  /** Send a POSIX signal. Mirrors `Bun.Subprocess.kill(signal)`. */
  kill: (signal?: "SIGTERM" | "SIGKILL") => void;
}

/** Best-effort teardown contract. Stage 7 formalises this in `Flow`. */
type TeardownReason = "cancelled" | "done" | "failed";
type Teardown = (reason: TeardownReason) => Promise<void> | void;

interface PreemptDeps {
  /** Persist the new assignment for the issue (e.g. into `.ralph-state.json`). */
  persist: (issueId: string, assignment: FlowAssignment) => Promise<void> | void;
  /** Event bus for `runtime.preempt.*` notifications. */
  bus?: Bus;
  /**
   * Time to wait between SIGTERM and SIGKILL escalation. Defaults to
   * 5000 ms. Overridable so tests don't have to sleep.
   */
  graceMs?: number;
}

interface PreemptInput {
  issueId: string;
  /** Currently-running flow's id (for the event payload). */
  from: FlowAssignment["flowId"];
  /** Worker subprocess to preempt. */
  worker: FlowWorker;
  /** Teardown hook for the running flow. Tolerated when absent. */
  teardown?: Teardown;
  /** New assignment to swap in once the running worker is reaped. */
  newAssignment: FlowAssignment;
}

/**
 * Preemption protocol:
 *   1. emit `runtime.preempt.started`
 *   2. SIGTERM
 *   3. wait up to `graceMs` for exit (default 5000 ms)
 *   4. SIGKILL if still alive
 *   5. await exit
 *   6. `teardown('cancelled')`
 *   7. persist new assignment
 *   8. emit `runtime.preempt.completed`
 */
export async function preempt(input: PreemptInput, deps: PreemptDeps): Promise<void> {
  const bus = deps.bus ?? createNoopBus();
  const graceMs = deps.graceMs ?? 5000;
  const { issueId, from, worker, teardown, newAssignment } = input;

  bus.emit({
    type: "runtime.preempt.started",
    issueId,
    from,
    to: newAssignment.flowId,
  });

  try {
    worker.kill("SIGTERM");
  } catch {
    /* ignore — worker may already be dead */
  }

  const exited = await Promise.race([
    worker.exited.then(() => "exited" as const),
    new Promise<"timeout">((resolve) => {
      const t = setTimeout(() => resolve("timeout"), graceMs);
      // unref so the timer doesn't pin the process
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

  if (teardown) {
    try {
      await teardown("cancelled");
    } catch {
      /* swallowed — teardown errors must not block preemption */
    }
  }

  await deps.persist(issueId, newAssignment);

  bus.emit({
    type: "runtime.preempt.completed",
    issueId,
    to: newAssignment.flowId,
  });
}
