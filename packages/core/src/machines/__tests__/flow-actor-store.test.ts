import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowActorStore } from "../flow-actor-store";
import { createNoopBus } from "@ralphy/events";
import type { FlowAssignment } from "../flow.machine";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "flow-actor-store-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("FlowActorStore", () => {
  test("getActor returns a fresh idle actor when no file exists", async () => {
    const store = new FlowActorStore();
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("getActor without changeDir returns a fresh idle actor", async () => {
    const store = new FlowActorStore();
    const actor = await store.getActor("issue-1");
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("getActor returns the same in-memory actor on subsequent calls", async () => {
    const store = new FlowActorStore();
    const a1 = await store.getActor("issue-1");
    const a2 = await store.getActor("issue-1");
    expect(a1).toBe(a2);
  });

  test("peekActor returns null when actor is not in memory", () => {
    const store = new FlowActorStore();
    expect(store.peekActor("issue-1")).toBeNull();
  });

  test("peekActor returns actor after getActor creates it", async () => {
    const store = new FlowActorStore();
    await store.getActor("issue-1");
    expect(store.peekActor("issue-1")).not.toBeNull();
  });

  test("snapshot persist → fresh store → rehydrate gives same state", async () => {
    const store1 = new FlowActorStore();
    const actor1 = await store1.getActor("issue-1", tmpDir);
    actor1.send({ type: "FRESH_PICKED_UP" });
    actor1.send({ type: "CONFLICT_DETECTED" });
    expect(actor1.getSnapshot().value).toBe("conflict-fix");

    await store1.persistActor("issue-1", tmpDir);

    const store2 = new FlowActorStore();
    const actor2 = await store2.getActor("issue-1", tmpDir);
    expect(actor2.getSnapshot().value).toBe("conflict-fix");
  });

  test("rehydrate from working state", async () => {
    const store1 = new FlowActorStore();
    const actor1 = await store1.getActor("issue-1", tmpDir);
    actor1.send({ type: "RESUME_DETECTED" });
    expect(actor1.getSnapshot().value).toBe("working");
    await store1.persistActor("issue-1", tmpDir);

    const store2 = new FlowActorStore();
    const actor2 = await store2.getActor("issue-1", tmpDir);
    expect(actor2.getSnapshot().value).toBe("working");
  });

  test("corrupt snapshot file falls back to idle", async () => {
    const stateFile = join(tmpDir, ".ralph-state.json");
    await Bun.write(stateFile, JSON.stringify({ flow: { actorSnapshot: "not-a-valid-snapshot" } }));

    const store = new FlowActorStore();
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("missing flow.actorSnapshot key falls back to idle", async () => {
    const stateFile = join(tmpDir, ".ralph-state.json");
    await Bun.write(stateFile, JSON.stringify({ confirmation: { askedAt: null } }));

    const store = new FlowActorStore();
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("invalid JSON file falls back to idle", async () => {
    const stateFile = join(tmpDir, ".ralph-state.json");
    await Bun.write(stateFile, "{ not valid json }}}");

    const store = new FlowActorStore();
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
  });

  test("disposeActor removes actor from map", async () => {
    const store = new FlowActorStore();
    await store.getActor("issue-1");
    expect(store.peekActor("issue-1")).not.toBeNull();

    store.disposeActor("issue-1");
    expect(store.peekActor("issue-1")).toBeNull();
  });

  test("disposeActor is a no-op when actor does not exist", () => {
    const store = new FlowActorStore();
    expect(() => store.disposeActor("nonexistent")).not.toThrow();
  });

  test("persistActor is a no-op when actor does not exist", async () => {
    const store = new FlowActorStore();
    await expect(store.persistActor("nonexistent", tmpDir)).resolves.toBeUndefined();
  });

  test("rehydrated actor re-injects a live runtime so preemption can persist", async () => {
    // Process A: an actor resting in `working`, then persisted to disk.
    const storeA = new FlowActorStore({ bus: createNoopBus(), persist: () => {} });
    const actorA = await storeA.getActor("issue-1", tmpDir);
    actorA.send({ type: "FRESH_PICKED_UP" });
    expect(actorA.getSnapshot().value).toBe("working");
    await storeA.persistActor("issue-1", tmpDir);

    // Process B (restart): a fresh store whose persist we can observe. The
    // on-disk snapshot has bus/persist stripped by JSON serialization — the
    // store must re-inject fresh runtime handles, or preemption (which emits
    // on the bus and calls persist) cannot run and the actor falls to `error`.
    const persisted: FlowAssignment[] = [];
    const storeB = new FlowActorStore({
      bus: createNoopBus(),
      persist: (_issueId, assignment) => {
        persisted.push(assignment);
      },
    });
    const actorB = await storeB.getActor("issue-1", tmpDir);
    expect(actorB.getSnapshot().value).toBe("working"); // serializable data restored

    const newAssignment: FlowAssignment = { flowId: "conflict-fix", reason: "scan", boost: "p1" };
    actorB.send({ type: "PREEMPT", newAssignment });
    // The preemption actor is a fromPromise — let its microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Live persist was re-injected → preemption completed and routed; not `error`.
    expect(persisted).toContainEqual(newAssignment);
    expect(actorB.getSnapshot().value).toBe("conflict-fix");
  });

  test("migrates a pre-split snapshot (top-level context fields) into context.data", async () => {
    // Build a real v5 persisted snapshot, then flatten its context to the
    // pre-split shape (serializable fields at the top level, no `data`) to
    // mimic a snapshot written by an older ralphy version.
    const seed = new FlowActorStore({ bus: createNoopBus(), persist: () => {} });
    const seedActor = await seed.getActor("issue-1", tmpDir);
    seedActor.send({ type: "FRESH_PICKED_UP" });
    seedActor.send({
      type: "WORKER_SPAWNED",
      worker: { exited: Promise.resolve(0), kill: () => {} },
      assignment: { flowId: "implement", reason: "r", boost: "p2" },
    } as never);
    const snap = JSON.parse(JSON.stringify(seedActor.getPersistedSnapshot())) as {
      context: { data: Record<string, unknown> };
    };
    const preSplit: { context: Record<string, unknown> } = {
      ...snap,
      context: { ...snap.context.data }, // hoist data fields to the top level
    };

    await Bun.write(
      join(tmpDir, ".ralph-state.json"),
      JSON.stringify({ flow: { actorSnapshot: preSplit } }),
    );

    const persisted: FlowAssignment[] = [];
    const store = new FlowActorStore({
      bus: createNoopBus(),
      persist: (_issueId, assignment) => {
        persisted.push(assignment);
      },
    });
    const actor = await store.getActor("issue-1", tmpDir);

    // Lifecycle state migrated into context.data (not reset to idle).
    expect(actor.getSnapshot().value).toBe("working");
    expect(actor.getSnapshot().context.data.issueId).toBe("issue-1");
    expect(actor.getSnapshot().context.data.currentAssignment).toEqual({
      flowId: "implement",
      reason: "r",
      boost: "p2",
    });

    // ...and runtime was re-injected, so a preempt still persists.
    const newAssignment: FlowAssignment = { flowId: "ci-fix", reason: "ci", boost: "p1" };
    actor.send({ type: "PREEMPT", newAssignment });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(persisted).toContainEqual(newAssignment);
  });

  test("different keys are independent actors", async () => {
    const store = new FlowActorStore();
    const a1 = await store.getActor("issue-1");
    const a2 = await store.getActor("issue-2");

    a1.send({ type: "FRESH_PICKED_UP" });
    a1.send({ type: "CONFLICT_DETECTED" });

    expect(a1.getSnapshot().value).toBe("conflict-fix");
    expect(a2.getSnapshot().value).toBe("idle");
  });
});
