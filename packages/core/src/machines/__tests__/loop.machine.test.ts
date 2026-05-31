import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { loopMachine } from "../loop.machine";
import type { LoopMachineOptions } from "../loop.machine";

const baseOptions: LoopMachineOptions = {
  maxIterations: 0,
  maxCostUsd: 0,
  maxRuntimeMinutes: 0,
  maxConsecutiveFailures: 0,
};

function startActor(options: LoopMachineOptions = baseOptions, startTime: number = Date.now()) {
  const actor = createActor(loopMachine).start();
  actor.send({ type: "START", options, startTime });
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
});
