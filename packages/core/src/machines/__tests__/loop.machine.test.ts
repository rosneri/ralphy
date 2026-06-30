import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { loopMachine, stoppedStateToReason } from "../loop.machine";
import type { LoopMachineOptions } from "../loop.machine";
import { STOP_REASONS } from "../../loop/stop-and-state";

const baseOptions: LoopMachineOptions = {
  maxIterations: 0,
  maxCostUsd: 0,
  maxRuntimeMinutes: 0,
  maxConsecutiveFailures: 0,
};

function startActor(
  options: LoopMachineOptions = baseOptions,
  startTime: number = Date.now(),
  startingIteration?: number,
  startingCostUsd?: number,
  startingStatus?: "active" | "blocked" | "completed",
) {
  const actor = createActor(loopMachine).start();
  actor.send({
    type: "START",
    options,
    startTime,
    ...(startingIteration !== undefined && { startingIteration }),
    ...(startingCostUsd !== undefined && { startingCostUsd }),
    ...(startingStatus !== undefined && { startingStatus }),
  });
  return actor;
}

describe("loopMachine", () => {
  test("starts in idle state", () => {
    const actor = createActor(loopMachine).start();
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("transitions to running after START with unlimited options", () => {
    const actor = startActor();
    expect(actor.getSnapshot().value).toBe("running");
  });

  test("maxIterations: stops at stopped.maxIterations when cap is reached", () => {
    const actor = startActor({ ...baseOptions, maxIterations: 2 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    expect(actor.getSnapshot().value).toEqual({ stopped: "maxIterations" });
  });

  test("completed: stops at stopped.completed when ALL_TASKS_DONE with no uncommitted edits", () => {
    const actor = startActor();
    actor.send({ type: "ALL_TASKS_DONE", uncommittedEdits: false });
    expect(actor.getSnapshot().value).toEqual({ stopped: "completed" });
  });

  test("costCap: stops at stopped.costCap when cost limit is reached", () => {
    const actor = startActor({ ...baseOptions, maxCostUsd: 10 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 10 });
    expect(actor.getSnapshot().value).toEqual({ stopped: "costCap" });
  });

  test("runtimeLimit: stops at stopped.runtimeLimit when wall-clock limit is exceeded", () => {
    // startTime=0 (epoch 0) guarantees the runtime guard fires immediately
    const actor = startActor({ ...baseOptions, maxRuntimeMinutes: 1 }, 0);
    expect(actor.getSnapshot().value).toEqual({ stopped: "runtimeLimit" });
  });

  test("consecutiveFailures: stops at stopped.consecutiveFailures after N failures in a row", () => {
    const actor = startActor({ ...baseOptions, maxConsecutiveFailures: 3 });
    actor.send({ type: "ITERATION_FAILED" });
    actor.send({ type: "ITERATION_FAILED" });
    actor.send({ type: "ITERATION_FAILED" });
    expect(actor.getSnapshot().value).toEqual({ stopped: "consecutiveFailures" });
  });

  test("rateLimited: stops at stopped.rateLimited on RATE_LIMITED event", () => {
    const actor = startActor();
    actor.send({ type: "RATE_LIMITED" });
    expect(actor.getSnapshot().value).toEqual({ stopped: "rateLimited" });
  });

  test("stranded: stops at stopped.stranded when ALL_TASKS_DONE with uncommitted edits", () => {
    const actor = startActor();
    actor.send({ type: "ALL_TASKS_DONE", uncommittedEdits: true });
    expect(actor.getSnapshot().value).toEqual({ stopped: "stranded" });
  });

  test("resets consecutiveFailures to 0 on ITERATION_DONE", () => {
    const actor = startActor({ ...baseOptions, maxConsecutiveFailures: 10 });
    actor.send({ type: "ITERATION_FAILED" });
    actor.send({ type: "ITERATION_FAILED" });
    expect(actor.getSnapshot().context.consecutiveFailures).toBe(2);
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    expect(actor.getSnapshot().context.consecutiveFailures).toBe(0);
  });

  test("maxIterations = 0 does not stop the loop", () => {
    const actor = startActor({ ...baseOptions, maxIterations: 0 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    expect(actor.getSnapshot().value).toBe("running");
  });

  test("START with seeds sets context.iteration and context.costUsd correctly", () => {
    const actor = startActor(baseOptions, Date.now(), 5, 1.5);
    expect(actor.getSnapshot().context.iteration).toBe(5);
    expect(actor.getSnapshot().context.costUsd).toBe(1.5);
  });

  test("START without seeds defaults iteration and costUsd to 0", () => {
    const actor = startActor();
    expect(actor.getSnapshot().context.iteration).toBe(0);
    expect(actor.getSnapshot().context.costUsd).toBe(0);
  });

  test("START with completed status stops immediately", () => {
    const actor = startActor(baseOptions, Date.now(), 0, 0, "completed");
    expect(actor.getSnapshot().value).toEqual({ stopped: "completed" });
  });

  test("maxIterations is respected when startingIteration is provided", () => {
    const actor = startActor({ ...baseOptions, maxIterations: 5 }, Date.now(), 4);
    // Already at iteration 4, one more ITERATION_DONE reaches 5 → should stop
    actor.send({ type: "ITERATION_DONE", costDeltaUsd: 0 });
    expect(actor.getSnapshot().value).toEqual({ stopped: "maxIterations" });
  });

  test("STATUS_CHANGED away from active stops at stopped.completed", () => {
    const actor = startActor();
    actor.send({ type: "STATUS_CHANGED", status: "blocked" });
    expect(actor.getSnapshot().value).toEqual({ stopped: "completed" });
  });

  test("STATUS_CHANGED to active keeps running", () => {
    const actor = startActor();
    actor.send({ type: "STATUS_CHANGED", status: "active" });
    expect(actor.getSnapshot().value).toBe("running");
  });
});

describe("stoppedStateToReason", () => {
  test("returns the reason for a known stopped substate", () => {
    expect(stoppedStateToReason({ value: { stopped: "costCap" } })).toBe("costCap");
  });

  test("returns null for an unknown stopped substate instead of casting it", () => {
    expect(stoppedStateToReason({ value: { stopped: "somethingNew" } })).toBeNull();
  });

  test("returns null for a non-stopped value", () => {
    expect(stoppedStateToReason({ value: "running" })).toBeNull();
  });
});

describe("loopMachine stopped substates are pinned to STOP_REASONS", () => {
  test("stopped child-state names equal new Set(STOP_REASONS)", () => {
    const substates = new Set(Object.keys(loopMachine.states.stopped?.states ?? {}));
    expect(substates).toEqual(new Set(STOP_REASONS));
  });
});
