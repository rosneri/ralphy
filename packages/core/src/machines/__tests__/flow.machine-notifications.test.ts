/**
 * RFC #402 — the flow machine owns recovery *notification* facts
 * (`detectionNotifiedAt` / `promotionNotifiedAt` / `bailNotifiedAt`) and the
 * failing PR's URL. These replace the coordinator's process-lifetime
 * `conflictNotified` / `ciFailedNotified` / `conflictPromoted` Sets, so the
 * comment dedup must survive a snapshot → JSON → rehydrate round-trip.
 */
import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { flowMachine } from "../flow.machine";

function actor(maxRecoveryAttempts = 5) {
  return createActor(flowMachine, { input: { issueId: "i1", maxRecoveryAttempts } }).start();
}

describe("flowMachine — recovery notification facts", () => {
  test("CONFLICT_DETECTED records the PR URL on recovery", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED", prUrl: "https://github.com/o/r/pull/7" });
    expect(a.getSnapshot().context.data.recovery?.prUrl).toBe("https://github.com/o/r/pull/7");
  });

  test("a re-detection without a URL keeps the previously recorded one", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED", prUrl: "https://github.com/o/r/pull/7" });
    a.send({ type: "WORKER_SUCCEEDED" }); // → awaiting-ci
    a.send({ type: "CI_FAILED_DETECTED" });
    expect(a.getSnapshot().context.data.recovery?.prUrl).toBe("https://github.com/o/r/pull/7");
  });

  test("RECOVERY_NOTIFIED stamps detection / promotion in a fix state", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "detection", at: "2026-06-10T10:00:00.000Z" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "promotion", at: "2026-06-10T10:00:01.000Z" });
    const recovery = a.getSnapshot().context.data.recovery;
    expect(recovery?.detectionNotifiedAt).toBe("2026-06-10T10:00:00.000Z");
    expect(recovery?.promotionNotifiedAt).toBe("2026-06-10T10:00:01.000Z");
  });

  test("RECOVERY_NOTIFIED bail stamps in quarantined", () => {
    const a = actor(1);
    a.send({ type: "CI_FAILED_DETECTED" }); // attempts 1 ≥ 1 → quarantined
    expect(a.getSnapshot().value).toBe("quarantined");
    a.send({ type: "RECOVERY_NOTIFIED", kind: "bail", at: "2026-06-10T11:00:00.000Z" });
    expect(a.getSnapshot().context.data.recovery?.bailNotifiedAt).toBe("2026-06-10T11:00:00.000Z");
  });

  test("fix-worker success clears the session stamps but keeps attempts", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "detection", at: "2026-06-10T10:00:00.000Z" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "promotion", at: "2026-06-10T10:00:01.000Z" });
    a.send({ type: "WORKER_SUCCEEDED" }); // → awaiting-ci, session resolved
    const recovery = a.getSnapshot().context.data.recovery;
    expect(recovery?.attempts).toBe(1);
    expect(recovery?.detectionNotifiedAt).toBeUndefined();
    expect(recovery?.promotionNotifiedAt).toBeUndefined();
  });

  test("a re-detection in the same session does NOT re-arm the dedup", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "detection", at: "2026-06-10T10:00:00.000Z" });
    a.send({ type: "WORKER_SUCCEEDED" }); // notified stamps cleared here…
    a.send({ type: "CI_FAILED_DETECTED" }); // …new session: must re-notify
    expect(a.getSnapshot().context.data.recovery?.detectionNotifiedAt).toBeUndefined();
  });

  test("the dedup survives a persist → JSON → rehydrate round-trip (restart-proof)", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED", prUrl: "https://github.com/o/r/pull/9" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "detection", at: "2026-06-10T10:00:00.000Z" });
    const persisted = JSON.parse(JSON.stringify(a.getPersistedSnapshot())) as never;
    const b = createActor(flowMachine, {
      snapshot: persisted,
      input: { issueId: "i1", maxRecoveryAttempts: 5 },
    }).start();
    expect(b.getSnapshot().value).toBe("conflict-fix");
    const recovery = b.getSnapshot().context.data.recovery;
    // The restarted process sees the stamp → no duplicate conflict comment.
    expect(recovery?.detectionNotifiedAt).toBe("2026-06-10T10:00:00.000Z");
    expect(recovery?.prUrl).toBe("https://github.com/o/r/pull/9");
  });

  test("QUARANTINE_CLEARED drops all notification stamps with the record", () => {
    const a = actor(1);
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "RECOVERY_NOTIFIED", kind: "bail", at: "2026-06-10T11:00:00.000Z" });
    a.send({ type: "QUARANTINE_CLEARED" });
    expect(a.getSnapshot().context.data.recovery).toBeUndefined();
  });
});
