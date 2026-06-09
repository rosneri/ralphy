import { describe, expect, test } from "bun:test";
import { createNoopBus } from "@ralphy/events";
import { FlowActorStore } from "../flow-actor-store";
import { flowMachine, preemptionActorLogic } from "../flow.machine";

const providedMachine = flowMachine.provide({ actors: { preemption: preemptionActorLogic } });

describe("FlowActorStore — transition history hook", () => {
  test("reports value transitions as {from,event,to}; ignores no-op events", async () => {
    const transitions: { from: string; event: string; to: string }[] = [];
    const store = new FlowActorStore(
      {
        bus: createNoopBus(),
        persist: () => {},
        onTransition: (_issueId, _changeDir, t) => transitions.push(t),
      },
      providedMachine,
    );

    const actor = await store.getActor("issue-1");
    actor.send({ type: "FRESH_PICKED_UP" }); // idle → working
    actor.send({ type: "PR_OPENED" }); // working → awaiting-ci
    actor.send({ type: "PR_OPENED" }); // awaiting-ci self-transition → no entry

    expect(transitions).toEqual([
      { from: "idle", event: "FRESH_PICKED_UP", to: "working" },
      { from: "working", event: "PR_OPENED", to: "awaiting-ci" },
    ]);
  });

  test("forwards the changeDir passed to getActor", async () => {
    const dirs: (string | undefined)[] = [];
    const store = new FlowActorStore(
      {
        bus: createNoopBus(),
        persist: () => {},
        onTransition: (_issueId, changeDir) => dirs.push(changeDir),
      },
      providedMachine,
    );
    // No snapshot at this dir → fresh idle actor, but the changeDir is still threaded.
    const actor = await store.getActor("issue-2", "/tmp/does-not-exist-change");
    actor.send({ type: "FRESH_PICKED_UP" });
    expect(dirs).toEqual(["/tmp/does-not-exist-change"]);
  });

  test("no hook wired → actor still drives normally (zero inspect overhead)", async () => {
    const store = new FlowActorStore({ bus: createNoopBus(), persist: () => {} }, providedMachine);
    const actor = await store.getActor("issue-3");
    actor.send({ type: "FRESH_PICKED_UP" });
    expect(actor.getSnapshot().value).toBe("working");
  });
});
