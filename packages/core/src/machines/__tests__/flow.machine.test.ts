import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { flowMachine } from "../flow.machine";

function actor() {
  return createActor(flowMachine, { input: {} }).start();
}

describe("flowMachine — idle entry events", () => {
  test("starts in idle", () => {
    expect(actor().getSnapshot().value).toBe("idle");
  });

  test("FRESH_PICKED_UP: idle → working", () => {
    const a = actor();
    a.send({ type: "FRESH_PICKED_UP" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("RESUME_DETECTED: idle → working", () => {
    const a = actor();
    a.send({ type: "RESUME_DETECTED" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("REVIEW_TRIGGERED: idle → review", () => {
    const a = actor();
    a.send({ type: "REVIEW_TRIGGERED" });
    expect(a.getSnapshot().value).toBe("review");
  });

  test("CONFLICT_DETECTED: idle → conflict-fix", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    expect(a.getSnapshot().value).toBe("conflict-fix");
  });

  test("CI_FAILED_DETECTED: idle → ci-fix", () => {
    const a = actor();
    a.send({ type: "CI_FAILED_DETECTED" });
    expect(a.getSnapshot().value).toBe("ci-fix");
  });

  test("irrelevant events are ignored in idle (WORKER_SUCCEEDED stays idle)", () => {
    const a = actor();
    a.send({ type: "WORKER_SUCCEEDED" } as never);
    expect(a.getSnapshot().value).toBe("idle");
  });
});

describe("flowMachine — working transitions", () => {
  function working() {
    const a = actor();
    a.send({ type: "FRESH_PICKED_UP" });
    return a;
  }

  test("working → awaiting on AWAITING_DETECTED", () => {
    const a = working();
    a.send({ type: "AWAITING_DETECTED" });
    expect(a.getSnapshot().value).toBe("awaiting");
  });

  test("working → conflict-fix on CONFLICT_DETECTED", () => {
    const a = working();
    a.send({ type: "CONFLICT_DETECTED" });
    expect(a.getSnapshot().value).toBe("conflict-fix");
  });

  test("working → ci-fix on CI_FAILED_DETECTED", () => {
    const a = working();
    a.send({ type: "CI_FAILED_DETECTED" });
    expect(a.getSnapshot().value).toBe("ci-fix");
  });

  test("working → done on WORKER_SUCCEEDED", () => {
    const a = working();
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("done");
  });

  test("working → error on WORKER_FAILED", () => {
    const a = working();
    a.send({ type: "WORKER_FAILED" });
    expect(a.getSnapshot().value).toBe("error");
  });

  test("RESUME_DETECTED is ignored in working (already active)", () => {
    const a = working();
    a.send({ type: "RESUME_DETECTED" } as never);
    expect(a.getSnapshot().value).toBe("working");
  });
});

describe("flowMachine — conflict-fix transitions", () => {
  function conflictFix() {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    return a;
  }

  test("conflict-fix → working on WORKER_SUCCEEDED", () => {
    const a = conflictFix();
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("conflict-fix → error on WORKER_FAILED", () => {
    const a = conflictFix();
    a.send({ type: "WORKER_FAILED" });
    expect(a.getSnapshot().value).toBe("error");
  });

  test("irrelevant events ignored in conflict-fix", () => {
    const a = conflictFix();
    a.send({ type: "AWAITING_DETECTED" } as never);
    expect(a.getSnapshot().value).toBe("conflict-fix");
  });
});

describe("flowMachine — ci-fix transitions", () => {
  function ciFix() {
    const a = actor();
    a.send({ type: "CI_FAILED_DETECTED" });
    return a;
  }

  test("ci-fix → working on WORKER_SUCCEEDED", () => {
    const a = ciFix();
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("ci-fix → error on WORKER_FAILED", () => {
    const a = ciFix();
    a.send({ type: "WORKER_FAILED" });
    expect(a.getSnapshot().value).toBe("error");
  });
});

describe("flowMachine — awaiting transitions", () => {
  function awaiting() {
    const a = actor();
    a.send({ type: "FRESH_PICKED_UP" });
    a.send({ type: "AWAITING_DETECTED" });
    return a;
  }

  test("awaiting → working on CONFIRMATION_CLEARED", () => {
    const a = awaiting();
    a.send({ type: "CONFIRMATION_CLEARED" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("irrelevant events ignored in awaiting", () => {
    const a = awaiting();
    a.send({ type: "WORKER_SUCCEEDED" } as never);
    expect(a.getSnapshot().value).toBe("awaiting");
  });
});

describe("flowMachine — review transitions", () => {
  function review() {
    const a = actor();
    a.send({ type: "REVIEW_TRIGGERED" });
    return a;
  }

  test("review → done on WORKER_SUCCEEDED", () => {
    const a = review();
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("done");
  });

  test("review → error on WORKER_FAILED", () => {
    const a = review();
    a.send({ type: "WORKER_FAILED" });
    expect(a.getSnapshot().value).toBe("error");
  });

  test("review: WORKER_SPAWNED stores worker and assignment in context", () => {
    const a = review();
    const fakeWorker = { exited: Promise.resolve(0), kill: () => {} };
    a.send({
      type: "WORKER_SPAWNED",
      worker: fakeWorker,
      assignment: { flowId: "implement", reason: "r", boost: "p2" },
    } as never);
    expect(a.getSnapshot().context.worker).toBe(fakeWorker);
  });
});

describe("flowMachine — PREEMPT and WORKER_SPAWNED in conflict-fix and ci-fix", () => {
  test("conflict-fix: WORKER_SPAWNED stores worker in context", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    const fakeWorker = { exited: Promise.resolve(0), kill: () => {} };
    a.send({
      type: "WORKER_SPAWNED",
      worker: fakeWorker,
      assignment: { flowId: "conflict-fix", reason: "r", boost: "p1" },
    } as never);
    expect(a.getSnapshot().context.worker).toBe(fakeWorker);
  });

  test("conflict-fix: PREEMPT stores pendingAssignment and transitions to preempting", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    const newAssignment = { flowId: "ci-fix" as const, reason: "ci failed", boost: "p1" as const };
    a.send({ type: "PREEMPT", newAssignment });
    expect(a.getSnapshot().context.pendingAssignment).toEqual(newAssignment);
  });

  test("ci-fix: WORKER_SPAWNED stores worker in context", () => {
    const a = actor();
    a.send({ type: "CI_FAILED_DETECTED" });
    const fakeWorker = { exited: Promise.resolve(0), kill: () => {} };
    a.send({
      type: "WORKER_SPAWNED",
      worker: fakeWorker,
      assignment: { flowId: "ci-fix", reason: "r", boost: "p1" },
    } as never);
    expect(a.getSnapshot().context.worker).toBe(fakeWorker);
  });

  test("ci-fix: PREEMPT stores pendingAssignment and transitions to preempting", () => {
    const a = actor();
    a.send({ type: "CI_FAILED_DETECTED" });
    const newAssignment = {
      flowId: "conflict-fix" as const,
      reason: "conflict",
      boost: "p0" as const,
    };
    a.send({ type: "PREEMPT", newAssignment });
    expect(a.getSnapshot().context.pendingAssignment).toEqual(newAssignment);
  });
});

describe("flowMachine — terminal states", () => {
  test("done is a final state", () => {
    const a = actor();
    a.send({ type: "FRESH_PICKED_UP" });
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("done");
    expect(a.getSnapshot().status).toBe("done");
  });

  test("error is a final state", () => {
    const a = actor();
    a.send({ type: "FRESH_PICKED_UP" });
    a.send({ type: "WORKER_FAILED" });
    expect(a.getSnapshot().value).toBe("error");
    expect(a.getSnapshot().status).toBe("done");
  });

  test("conflict-fix success cycles back to working (not done)", () => {
    const a = actor();
    a.send({ type: "CONFLICT_DETECTED" });
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("working");
  });

  test("ci-fix success cycles back to working", () => {
    const a = actor();
    a.send({ type: "CI_FAILED_DETECTED" });
    a.send({ type: "WORKER_SUCCEEDED" });
    expect(a.getSnapshot().value).toBe("working");
  });
});
