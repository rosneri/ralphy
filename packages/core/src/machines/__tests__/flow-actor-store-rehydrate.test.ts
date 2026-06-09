/**
 * Phase 2 characterization — XState v5 (5.32.0) snapshot-restore semantics.
 *
 * These tests pin down the *actual* behavior of `createActor(machine, {
 * snapshot, input })` before the FlowContext data/runtime split relies on it.
 * The plan's claim: v5 restores context **from the snapshot** and does NOT
 * re-run the `context` factory on a snapshot restore, so the `input` re-passed
 * alongside `snapshot` does not repopulate non-serializable handles. After a
 * JSON round-trip (the production disk path) those handles are gone.
 *
 * If any of these fail, the data/runtime split's re-injection strategy must
 * change — so they are the gate for the refactor, not an afterthought.
 */
import { describe, expect, test } from "bun:test";
import { createActor } from "xstate";
import { flowMachine } from "../flow.machine";
import { createNoopBus } from "@ralphy/events";

describe("XState v5 snapshot restore — FlowContext handle hazard", () => {
  test("createActor({snapshot, input}) restores context from snapshot, ignoring re-passed input handles", () => {
    // 1. Fresh actor with a *distinct, identifiable* persist handle.
    const originalBus = createNoopBus();
    const originalPersist = (): void => {};
    const a1 = createActor(flowMachine, {
      input: { issueId: "issue-1", bus: originalBus, persist: originalPersist, graceMs: 1234 },
    });
    a1.start();
    a1.send({ type: "FRESH_PICKED_UP" });
    expect(a1.getSnapshot().value).toBe("working");
    expect(a1.getSnapshot().context.runtime.persist).toBe(originalPersist);

    // 2. Take the in-memory persisted snapshot (no disk yet — handles still
    //    live as references at this point).
    const snapshot = a1.getPersistedSnapshot();

    // 3. Rehydrate with a *different* input. If v5 re-ran the factory, context
    //    would pick up `freshPersist`. The plan says it will NOT.
    const freshBus = createNoopBus();
    const freshPersist = (): void => {};
    const a2 = createActor(flowMachine, {
      snapshot,
      input: { issueId: "issue-1", bus: freshBus, persist: freshPersist, graceMs: 9999 },
    });
    a2.start();

    expect(a2.getSnapshot().value).toBe("working");
    const ctx = a2.getSnapshot().context;
    // CHARACTERIZATION: the re-passed input is ignored; context comes from the snapshot.
    expect(ctx.runtime.persist).toBe(originalPersist);
    expect(ctx.runtime.persist).not.toBe(freshPersist);
    expect(ctx.data.graceMs).toBe(1234);
  });

  test("after a JSON round-trip (production disk path), non-serializable handles are lost on rehydrate", () => {
    const originalPersist = (): void => {};
    const a1 = createActor(flowMachine, {
      input: { issueId: "issue-1", persist: originalPersist, graceMs: 1234 },
    });
    a1.start();
    a1.send({ type: "FRESH_PICKED_UP" });

    // Production path: getPersistedSnapshot() → JSON → disk → JSON → restore.
    const onDisk = JSON.parse(JSON.stringify(a1.getPersistedSnapshot()));

    const freshPersist = (): void => {};
    const a2 = createActor(flowMachine, {
      snapshot: onDisk,
      input: { issueId: "issue-1", persist: freshPersist, graceMs: 9999 },
    });
    a2.start();

    const ctx = a2.getSnapshot().context;
    expect(a2.getSnapshot().value).toBe("working");
    // The function did not survive JSON, and the factory did not re-run to
    // restore it from input → it is gone. THIS is the latent production hazard
    // that FlowActorStore.getActor mitigates by re-injecting `runtime`.
    expect(typeof ctx.runtime.persist).not.toBe("function");
    expect(ctx.runtime.persist).not.toBe(freshPersist);
    // Serializable data, by contrast, round-trips fine.
    expect(ctx.data.graceMs).toBe(1234);
    expect(ctx.data.issueId).toBe("issue-1");
  });
});
