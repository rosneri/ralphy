import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowActorStore } from "../flow-actor-store";

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
