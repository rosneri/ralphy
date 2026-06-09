/**
 * Phase 3 — the flow machine owns the recovery counter and the terminal-ish
 * `quarantined` state (previously the pr-tracker file was a parallel source of
 * truth for `attempts` / `bailed` / `lastReason`). These tests pin the counter
 * and quarantine-threshold semantics deterministically, at the machine level,
 * before the coordinator is rewired to read them.
 */
import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { flowMachine } from "../flow.machine";

/** Actor with a configured quarantine threshold (production passes
 *  `prRecovery.maxRecoverySessions`, default 3). */
function recoveryActor(maxRecoveryAttempts: number) {
  return createActor(flowMachine, { input: { maxRecoveryAttempts } }).start();
}

/** Drive one full recovery round: a detection routes to a fix state, then the
 *  fix worker succeeds and the PR returns to `awaiting-ci`. */
function detectThenRecover(
  a: ReturnType<typeof recoveryActor>,
  event: "CONFLICT_DETECTED" | "CI_FAILED_DETECTED",
): void {
  a.send({ type: event });
  if (a.getSnapshot().value !== "quarantined") {
    a.send({ type: "WORKER_SUCCEEDED" });
  }
}

describe("flowMachine — recovery counter", () => {
  test("CONFLICT_DETECTED records attempts and lastReason in context.data.recovery", () => {
    const a = recoveryActor(3);
    a.send({ type: "CONFLICT_DETECTED", at: "2026-06-09T10:00:00.000Z" });
    expect(a.getSnapshot().value).toBe("conflict-fix");
    expect(a.getSnapshot().context.data.recovery).toEqual({
      attempts: 1,
      lastReason: "conflicting",
      firstFailedAt: "2026-06-09T10:00:00.000Z",
    });
  });

  test("CI_FAILED_DETECTED records lastReason ci_failed", () => {
    const a = recoveryActor(3);
    a.send({ type: "CI_FAILED_DETECTED", at: "2026-06-09T10:00:00.000Z" });
    expect(a.getSnapshot().value).toBe("ci-fix");
    expect(a.getSnapshot().context.data.recovery?.lastReason).toBe("ci_failed");
  });

  test("firstFailedAt is preserved across attempts; attempts accumulates over the recovery cycle", () => {
    const a = recoveryActor(5);
    a.send({ type: "CONFLICT_DETECTED", at: "2026-06-09T10:00:00.000Z" });
    a.send({ type: "WORKER_SUCCEEDED" }); // → awaiting-ci
    a.send({ type: "CI_FAILED_DETECTED", at: "2026-06-09T11:00:00.000Z" });
    expect(a.getSnapshot().value).toBe("ci-fix");
    const recovery = a.getSnapshot().context.data.recovery;
    expect(recovery?.attempts).toBe(2);
    expect(recovery?.lastReason).toBe("ci_failed");
    expect(recovery?.firstFailedAt).toBe("2026-06-09T10:00:00.000Z"); // first wins
  });

  test("reaching maxRecoveryAttempts routes to quarantined instead of a fix state", () => {
    const a = recoveryActor(3);
    detectThenRecover(a, "CONFLICT_DETECTED"); // attempts 1 → conflict-fix → awaiting-ci
    detectThenRecover(a, "CONFLICT_DETECTED"); // attempts 2 → conflict-fix → awaiting-ci
    a.send({ type: "CONFLICT_DETECTED" }); // attempts 3 ≥ 3 → quarantined
    expect(a.getSnapshot().value).toBe("quarantined");
    expect(a.getSnapshot().context.data.recovery?.attempts).toBe(3);
    expect(a.getSnapshot().context.data.recovery?.lastReason).toBe("conflicting");
  });

  test("a conflict→CI escalation quarantines on the CI failure and records ci_failed", () => {
    const a = recoveryActor(2);
    detectThenRecover(a, "CONFLICT_DETECTED"); // attempts 1 → awaiting-ci
    a.send({ type: "CI_FAILED_DETECTED" }); // attempts 2 ≥ 2 → quarantined
    expect(a.getSnapshot().value).toBe("quarantined");
    expect(a.getSnapshot().context.data.recovery?.lastReason).toBe("ci_failed");
  });

  test("maxRecoveryAttempts <= 0 never quarantines (recovery threshold disabled)", () => {
    const a = recoveryActor(0);
    for (let i = 0; i < 5; i++) {
      a.send({ type: "CONFLICT_DETECTED" });
      a.send({ type: "WORKER_SUCCEEDED" });
    }
    a.send({ type: "CONFLICT_DETECTED" });
    expect(a.getSnapshot().value).toBe("conflict-fix");
    expect(a.getSnapshot().context.data.recovery?.attempts).toBe(6);
  });

  test("QUARANTINE_CLEARED resets the counter and returns to idle", () => {
    const a = recoveryActor(1);
    a.send({ type: "CONFLICT_DETECTED" }); // attempts 1 ≥ 1 → quarantined
    expect(a.getSnapshot().value).toBe("quarantined");
    a.send({ type: "QUARANTINE_CLEARED" });
    expect(a.getSnapshot().value).toBe("idle");
    expect(a.getSnapshot().context.data.recovery).toBeUndefined();
  });

  test("recovery survives WORKER_SUCCEEDED (conflict-fix/ci-fix → awaiting-ci)", () => {
    // The linchpin of the board fold: a recovering PR that returns to
    // awaiting-ci keeps its recovery record, so the board can still show it as
    // failing rather than cleanly-waiting.
    const a = recoveryActor(5);
    a.send({ type: "CONFLICT_DETECTED" });
    expect(a.getSnapshot().value).toBe("conflict-fix");
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("awaiting-ci");
    expect(a.getSnapshot().context.data.recovery).toEqual({
      attempts: 1,
      lastReason: "conflicting",
      firstFailedAt: "",
    });
  });

  test("RECOVERY_CLEARED drops the record in awaiting-ci (mergeable PR)", () => {
    const a = recoveryActor(5);
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "WORKER_SUCCEEDED" }); // → awaiting-ci with recovery
    a.send({ type: "RECOVERY_CLEARED" });
    expect(a.getSnapshot().value).toBe("awaiting-ci");
    expect(a.getSnapshot().context.data.recovery).toBeUndefined();
  });

  test("a quarantined PR that becomes mergeable advances to done via PR_PASSED", () => {
    const a = recoveryActor(1);
    a.send({ type: "CONFLICT_DETECTED" }); // → quarantined
    expect(a.getSnapshot().value).toBe("quarantined");
    a.send({ type: "PR_PASSED" });
    expect(a.getSnapshot().value).toBe("done");
  });

  test("re-detection while quarantined refreshes lastReason without re-counting", () => {
    const a = recoveryActor(1);
    a.send({ type: "CONFLICT_DETECTED" }); // → quarantined, attempts 1, conflicting
    a.send({ type: "CI_FAILED_DETECTED" }); // stays quarantined, refresh reason only
    expect(a.getSnapshot().value).toBe("quarantined");
    expect(a.getSnapshot().context.data.recovery?.attempts).toBe(1);
    expect(a.getSnapshot().context.data.recovery?.lastReason).toBe("ci_failed");
  });
});
