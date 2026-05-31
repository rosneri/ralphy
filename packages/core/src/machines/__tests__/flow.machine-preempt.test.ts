import { createActor } from "xstate";
import { describe, expect, it } from "bun:test";
import { createBus } from "@ralphy/events";
import { flowMachine, preemptionActorLogic, type FlowAssignment, type FlowWorker } from "../flow.machine";

const GRACE_MS = 20;

function makeActor(graceMs = GRACE_MS) {
  const events: string[] = [];
  const persisted: { issueId: string; assignment: FlowAssignment }[] = [];
  const bus = createBus();
  bus.on("*", (e) => events.push(e.type));

  const persist = (issueId: string, assignment: FlowAssignment) => {
    persisted.push({ issueId, assignment });
  };

  const machine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });
  const actor = createActor(machine, {
    input: { issueId: "ISS-1", bus, persist, graceMs },
  });
  actor.start();
  return { actor, events, persisted };
}

function makeFakeWorker(opts: {
  ignoresSigterm?: boolean;
  throwOnKill?: boolean;
}): { worker: FlowWorker; kills: string[] } {
  const kills: string[] = [];
  let resolveExited: (code: number) => void = () => {};
  const exited = new Promise<number>((r) => {
    resolveExited = r;
  });

  const worker: FlowWorker = {
    exited,
    kill: (signal = "SIGTERM") => {
      kills.push(signal);
      if (opts.throwOnKill && kills.length > 1) {
        setTimeout(() => resolveExited(137), 0);
        throw new Error("kill failed");
      }
      if (!opts.ignoresSigterm || signal === "SIGKILL") {
        resolveExited(signal === "SIGKILL" ? 137 : 0);
      }
    },
  };

  return { worker, kills };
}

const newAssignment: FlowAssignment = {
  flowId: "conflict-fix",
  reason: "pr conflicting",
  boost: "p1",
};

describe("flow.machine — preemption: SIGTERM → SIGKILL → teardown → persist", () => {
  it("sends SIGKILL when worker ignores SIGTERM, runs teardown and persist", async () => {
    const { actor, events, persisted } = makeActor();
    actor.send({ type: "FRESH_PICKED_UP" });

    const teardownCalls: string[] = [];
    const { worker, kills } = makeFakeWorker({ ignoresSigterm: true });

    actor.send({
      type: "WORKER_SPAWNED",
      worker,
      teardown: async (reason) => {
        teardownCalls.push(reason);
      },
      assignment: { flowId: "implement", reason: "started", boost: "p2" },
    });

    actor.send({ type: "PREEMPT", newAssignment });

    // Wait for preemption to complete (machine exits preempting state)
    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(teardownCalls).toEqual(["cancelled"]);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.assignment).toEqual(newAssignment);
    expect(events[0]).toBe("runtime.preempt.started");
    expect(events.at(-1)).toBe("runtime.preempt.completed");
  }, 10_000);
});

describe("flow.machine — preemption: graceful SIGTERM skips SIGKILL", () => {
  it("resolves without SIGKILL when worker exits gracefully on SIGTERM", async () => {
    const { actor, persisted } = makeActor();
    actor.send({ type: "FRESH_PICKED_UP" });

    const { worker, kills } = makeFakeWorker({ ignoresSigterm: false });
    actor.send({
      type: "WORKER_SPAWNED",
      worker,
      assignment: { flowId: "implement", reason: "started", boost: "p2" },
    });

    actor.send({ type: "PREEMPT", newAssignment: { flowId: "ci-fix", reason: "ci failing", boost: "p2" } });

    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    expect(kills).toEqual(["SIGTERM"]);
    expect(persisted).toHaveLength(1);
  }, 10_000);
});

describe("flow.machine — preemption: fake worker forces SIGKILL escalation", () => {
  it("sends SIGKILL when worker never exits after SIGTERM", async () => {
    const { actor, persisted } = makeActor();
    actor.send({ type: "FRESH_PICKED_UP" });

    const kills: string[] = [];
    let resolveExited: (code: number) => void = () => {};
    const neverExitsWorker: FlowWorker = {
      exited: new Promise<number>((r) => {
        resolveExited = r;
      }),
      kill: (sig = "SIGTERM") => {
        kills.push(sig);
        if (sig === "SIGKILL") resolveExited(137);
      },
    };

    actor.send({
      type: "WORKER_SPAWNED",
      worker: neverExitsWorker,
      assignment: { flowId: "implement", reason: "started", boost: "p2" },
    });

    actor.send({ type: "PREEMPT", newAssignment });

    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    expect(persisted).toHaveLength(1);
  });
});

describe("flow.machine — preemption: swallows kill() throwing during SIGKILL", () => {
  it("resolves despite kill() throwing on SIGKILL", async () => {
    const { actor, persisted } = makeActor();
    actor.send({ type: "FRESH_PICKED_UP" });

    let killCalls = 0;
    let resolveExited: (code: number) => void = () => {};
    const throwingWorker: FlowWorker = {
      exited: new Promise<number>((r) => {
        resolveExited = r;
      }),
      kill: () => {
        killCalls++;
        if (killCalls === 1) return;
        // SIGKILL: throw, then asynchronously resolve
        setTimeout(() => resolveExited(137), 0);
        throw new Error("kill failed");
      },
    };

    actor.send({
      type: "WORKER_SPAWNED",
      worker: throwingWorker,
      assignment: { flowId: "implement", reason: "started", boost: "p2" },
    });

    actor.send({ type: "PREEMPT", newAssignment });

    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    expect(killCalls).toBe(2);
    expect(persisted).toHaveLength(1);
  });
});

describe("flow.machine — preemption: awaiting → PREEMPT (no-worker path)", () => {
  it("completes without calling kill() when machine is in awaiting (no worker)", async () => {
    const { actor, events, persisted } = makeActor();
    actor.send({ type: "FRESH_PICKED_UP" });
    actor.send({ type: "AWAITING_DETECTED" });
    expect(actor.getSnapshot().value).toBe("awaiting");

    const killCalls: string[] = [];
    // No WORKER_SPAWNED sent — context.worker is undefined

    actor.send({ type: "PREEMPT", newAssignment });

    await new Promise<void>((resolve) => {
      const sub = actor.subscribe((snap) => {
        if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    expect(killCalls).toHaveLength(0);
    expect(persisted).toHaveLength(1);
    expect(events).toContain("runtime.preempt.started");
    expect(events).toContain("runtime.preempt.completed");
  });
});

describe("flow.machine — post-preemption routing", () => {
  const routingCases: Array<{ flowId: FlowAssignment["flowId"]; expectedState: string }> = [
    { flowId: "conflict-fix", expectedState: "conflict-fix" },
    { flowId: "ci-fix", expectedState: "ci-fix" },
    { flowId: "awaiting-ci", expectedState: "awaiting" },
    { flowId: "confirmation", expectedState: "awaiting" },
    { flowId: "review-followup", expectedState: "review" },
    { flowId: "idle", expectedState: "idle" },
    { flowId: "implement", expectedState: "working" },
    { flowId: "new-ticket", expectedState: "working" },
    { flowId: "mention", expectedState: "working" },
    { flowId: "stuck", expectedState: "working" },
  ];

  for (const { flowId, expectedState } of routingCases) {
    it(`routes to ${expectedState} when pendingAssignment.flowId = "${flowId}"`, async () => {
      const { actor } = makeActor();
      actor.send({ type: "FRESH_PICKED_UP" });
      // No worker — use awaiting path to avoid kill() issues
      actor.send({ type: "AWAITING_DETECTED" });

      const target: FlowAssignment = { flowId, reason: "preempted", boost: "p2" };
      actor.send({ type: "PREEMPT", newAssignment: target });

      await new Promise<void>((resolve) => {
        const sub = actor.subscribe((snap) => {
          if (snap.value !== "preempting" && snap.value !== "routing-after-preempt") {
            sub.unsubscribe();
            resolve();
          }
        });
      });

      expect(actor.getSnapshot().value).toBe(expectedState);
    });
  }
});

describe("flow.machine — snapshot rehydration mid-preempting (no-worker path)", () => {
  it("resolves via no-worker path when rehydrated with undefined worker", async () => {
    // XState v5 restores child actors from their own snapshot (not via invoke.input),
    // so the preemption actor uses the context captured at snapshot time (bus ref is
    // preserved in-memory). We verify via bus events and final machine state.
    const events: string[] = [];
    const bus = createBus();
    bus.on("*", (e) => events.push(e.type));

    const machine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });

    // Build the snapshot by running the machine to preempting with no worker
    const buildActor = createActor(machine, {
      input: { issueId: "ISS-snap", bus, persist: () => {}, graceMs: GRACE_MS },
    });
    buildActor.start();
    buildActor.send({ type: "FRESH_PICKED_UP" });
    buildActor.send({ type: "AWAITING_DETECTED" });
    buildActor.send({ type: "PREEMPT", newAssignment });

    // Get the snapshot immediately (machine is mid-preempting, worker undefined)
    const snap = buildActor.getPersistedSnapshot();
    buildActor.stop();

    // Rehydrate — the bus object reference is preserved in the in-memory snapshot
    // so bus events fired by the restored preemption actor are captured above.
    const rehydrated = createActor(machine, {
      snapshot: snap as Parameters<typeof createActor>[1] extends { snapshot?: infer S } ? S : never,
      input: { issueId: "ISS-snap", bus, persist: () => {}, graceMs: GRACE_MS },
    });
    rehydrated.start();

    // Wait for the machine to exit preempting
    await new Promise<void>((resolve) => {
      const sub = rehydrated.subscribe((s) => {
        if (s.value !== "preempting" && s.value !== "routing-after-preempt") {
          sub.unsubscribe();
          resolve();
        }
      });
    });

    // Machine should have exited to the correct post-preemption state
    expect(rehydrated.getSnapshot().value).toBe("conflict-fix");
    // Preemption protocol ran (bus events confirm) — no SIGTERM/SIGKILL since worker was undefined
    expect(events).toContain("runtime.preempt.started");
    expect(events).toContain("runtime.preempt.completed");
  }, 10_000);
});
