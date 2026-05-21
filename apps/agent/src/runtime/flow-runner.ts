import type { Bus } from "@ralphy/events";
import { createNoopBus } from "@ralphy/events";
import type { FlowAssignment } from "./types";

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
export type TeardownReason = "cancelled" | "done" | "failed";
export type Teardown = (reason: TeardownReason) => Promise<void> | void;

export interface PreemptDeps {
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

export interface PreemptInput {
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
      (t as unknown as { unref?: () => void }).unref?.();
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

export interface RunInput {
  assignment: FlowAssignment;
  /**
   * Body of the flow — invoked once. Implementations spawn a worker and
   * resolve when it exits. Kept abstract so Stage 7's `Flow` contract can
   * be slotted in without changing the runner's shape.
   */
  body: () => Promise<void>;
}

/** Minimal `run` entry point — invokes the flow body. */
export async function run(input: RunInput): Promise<void> {
  await input.body();
}
