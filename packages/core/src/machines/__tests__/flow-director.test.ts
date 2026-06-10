/**
 * RFC #402 — FlowDirector is the ONE gateway to flow actors. These tests run
 * the real machine + real FlowActorStore (never mocked, per the dependency
 * strategy); persistence goes to a temp dir.
 */
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createNoopBus } from "@ralphy/events";
import { FlowActorStore } from "../flow-actor-store";
import { FlowDirector } from "../flow-director";

let dir: string;
let store: FlowActorStore;
let director: FlowDirector;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "flow-director-test-"));
  store = new FlowActorStore({ bus: createNoopBus(), persist: () => {}, maxRecoveryAttempts: 3 });
  director = new FlowDirector(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FlowDirector", () => {
  test("dispatch sends events and returns the resulting view", async () => {
    const view = await director.dispatch(
      { key: "i1", changeDir: dir },
      { type: "RESUME_DETECTED" },
    );
    expect(view).toEqual({ issueId: "i1", value: "working", recovery: undefined });
  });

  test("dispatch persists the snapshot to the change dir", async () => {
    await director.dispatch({ key: "i1", changeDir: dir }, { type: "FRESH_PICKED_UP" });
    const sidecar = JSON.parse(await readFile(join(dir, ".ralph-state.flow.json"), "utf8")) as {
      actorSnapshot?: { value?: string };
    };
    expect(sidecar.actorSnapshot?.value).toBe("working");
  });

  test("dispatch with multiple events applies them in order", async () => {
    const view = await director.dispatch(
      { key: "i1", changeDir: dir },
      { type: "RESUME_DETECTED" },
      { type: "CONFLICT_DETECTED", at: "2026-06-10T09:00:00.000Z", prUrl: "u" },
    );
    expect(view.value).toBe("conflict-fix");
    expect(view.recovery?.prUrl).toBe("u");
  });

  test("concurrent dispatches on the same key serialize (no double-rehydrate)", async () => {
    // Fire two dispatches without awaiting in between. If creation were not
    // serialized, both could rehydrate fresh actors and each apply one event
    // to its own copy; serialized, the second sees the first's result.
    const [first, second] = await Promise.all([
      director.dispatch({ key: "i1", changeDir: dir }, { type: "RESUME_DETECTED" }),
      director.dispatch({ key: "i1", changeDir: dir }, { type: "CONFLICT_DETECTED" }),
    ]);
    expect(first.value).toBe("working");
    expect(second.value).toBe("conflict-fix");
    expect(second.recovery?.attempts).toBe(1);
  });

  test("dispatch survives a prior failed dispatch on the same key", async () => {
    class FailOnceStore extends FlowActorStore {
      private calls = 0;
      override async getActor(key: string, changeDir?: string) {
        this.calls += 1;
        if (this.calls === 1) throw new Error("boom");
        return super.getActor(key, changeDir);
      }
    }
    const failOnce = new FlowDirector(
      new FailOnceStore({ bus: createNoopBus(), persist: () => {} }),
    );
    await expect(
      failOnce.dispatch({ key: "i1", changeDir: dir }, { type: "RESUME_DETECTED" }),
    ).rejects.toThrow("boom");
    const view = await failOnce.dispatch(
      { key: "i1", changeDir: dir },
      { type: "RESUME_DETECTED" },
    );
    expect(view.value).toBe("working");
  });

  test("view rehydrates from disk without sending events", async () => {
    await director.dispatch(
      { key: "i1", changeDir: dir },
      { type: "RESUME_DETECTED" },
      { type: "PR_OPENED" },
    );
    // Simulate a restart: fresh store + director over the same dir.
    const store2 = new FlowActorStore({ bus: createNoopBus(), persist: () => {} });
    const director2 = new FlowDirector(store2);
    const view = await director2.view({ key: "i1", changeDir: dir });
    expect(view.value).toBe("awaiting-ci");
  });

  test("peek is null for unloaded keys and a view for loaded ones", async () => {
    expect(director.peek("i1")).toBeNull();
    await director.dispatch({ key: "i1" }, { type: "FRESH_PICKED_UP" });
    expect(director.peek("i1")?.value).toBe("working");
  });

  test("dispatchLoaded sends only to in-memory actors", async () => {
    expect(director.dispatchLoaded("i1", { type: "FRESH_PICKED_UP" })).toBeNull();
    await director.dispatch({ key: "i1" }, { type: "FRESH_PICKED_UP" });
    const view = director.dispatchLoaded("i1", { type: "AWAITING_DETECTED" });
    expect(view?.value).toBe("awaiting");
  });

  test("disposeIfDone removes terminal actors and keeps live ones", async () => {
    await director.dispatch({ key: "live" }, { type: "FRESH_PICKED_UP" });
    await director.dispatch(
      { key: "dead" },
      { type: "FRESH_PICKED_UP" },
      { type: "WORKER_SUCCEEDED" },
    );
    director.disposeIfDone("live");
    director.disposeIfDone("dead");
    expect(director.peek("live")?.value).toBe("working");
    expect(director.peek("dead")).toBeNull();
  });
});
