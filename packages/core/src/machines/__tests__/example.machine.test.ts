import { createActor } from "xstate";
import { describe, expect, test } from "bun:test";
import { exampleMachine } from "../example.machine";

describe("exampleMachine", () => {
  test("starts in idle state", () => {
    const actor = createActor(exampleMachine).start();
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("transitions idle → active on START", () => {
    const actor = createActor(exampleMachine).start();
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("active");
  });

  test("transitions active → idle on STOP", () => {
    const actor = createActor(exampleMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "STOP" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("ignores unknown events in idle state", () => {
    const actor = createActor(exampleMachine).start();
    actor.send({ type: "STOP" } as never);
    expect(actor.getSnapshot().value).toBe("idle");
  });
});
