/**
 * Boundary tests for the FlowActorStore correctness fixes (issue #405):
 *
 * 1. Rehydration race — two concurrent `getActor(key, changeDir)` calls must
 *    resolve to the SAME actor, not double-create from the same snapshot.
 * 2. Snapshot validation — a snapshot whose `context.data.issueId` does not
 *    match the requested key, or whose `value` is not a known machine state,
 *    must fall back to a fresh actor with a warning.
 * 3. Migration — a snapshot carrying BOTH the legacy top-level context fields
 *    and the new `context.data` structure must warn that the new shape won.
 * 4. Persist — `persistActor` on a key with no registered actor must warn so
 *    callers do not assume the snapshot was saved.
 *
 * TDD note: each fix has a `bug_case` (originally pinned the pre-fix broken
 * behavior; inverted after the fix landed so it stays as a regression guard
 * that the broken behavior cannot return) and a `fix_case` (asserts the
 * corrected behavior).
 */
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FlowActorStore, type FlowActorDeps } from "../flow-actor-store";
import { createNoopBus } from "@ralphy/events";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "flow-actor-store-correctness-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeDeps(warn: (message: string) => void): FlowActorDeps {
  return { bus: createNoopBus(), persist: () => {}, warn };
}

/** A real v5 persisted snapshot for `key`, resting in `working`, as it would
 *  land on disk (JSON round-tripped). */
async function buildWorkingSnapshot(key: string): Promise<{
  context: { data: Record<string, unknown> };
}> {
  const seed = new FlowActorStore();
  const actor = await seed.getActor(key);
  actor.send({ type: "FRESH_PICKED_UP" });
  expect(actor.getSnapshot().value).toBe("working");
  const snap = JSON.parse(JSON.stringify(actor.getPersistedSnapshot())) as {
    context: { data: Record<string, unknown> };
  };
  seed.disposeActor(key);
  return snap;
}

/** Write a snapshot into the legacy inline `.ralph-state.json` (the migration
 *  read path) so tests can plant arbitrary snapshot shapes. */
async function writeInlineSnapshot(snapshot: unknown): Promise<void> {
  await Bun.write(
    join(tmpDir, ".ralph-state.json"),
    JSON.stringify({ flow: { actorSnapshot: snapshot } }),
  );
}

describe("FlowActorStore rehydration race", () => {
  test("bug_case (inverted): concurrent getActor calls no longer double-create actors", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot(snap);

    const store = new FlowActorStore();
    const [a1, a2] = await Promise.all([
      store.getActor("issue-1", tmpDir),
      store.getActor("issue-1", tmpDir),
    ]);
    // Pre-fix, both calls missed the registry (it was populated only after
    // the awaited loadSnapshot) and each rehydrated its own actor.
    expect(a1).toBe(a2);
  });

  test("fix_case: concurrent getActor calls resolve to the same actor", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot(snap);

    const store = new FlowActorStore();
    const [a1, a2, a3] = await Promise.all([
      store.getActor("issue-1", tmpDir),
      store.getActor("issue-1", tmpDir),
      store.getActor("issue-1", tmpDir),
    ]);
    expect(a1).toBe(a2);
    expect(a2).toBe(a3);
    expect(a1.getSnapshot().value).toBe("working");
    // A later call still hits the in-memory registry.
    expect(await store.getActor("issue-1", tmpDir)).toBe(a1);
  });

  test("fix_case: concurrent getActor calls for different keys stay independent", async () => {
    const store = new FlowActorStore();
    const [a1, a2] = await Promise.all([
      store.getActor("issue-1", tmpDir),
      store.getActor("issue-2", tmpDir),
    ]);
    expect(a1).not.toBe(a2);
  });
});

describe("FlowActorStore snapshot validation", () => {
  test("bug_case (inverted): a snapshot persisted for another key is no longer adopted", async () => {
    const snap = await buildWorkingSnapshot("other-issue");
    await writeInlineSnapshot(snap);

    const store = new FlowActorStore(makeDeps(mock((_message: string) => {})));
    const actor = await store.getActor("issue-1", tmpDir);
    // Pre-fix, the snapshot rehydrated under the wrong key, carrying the
    // other issue's identity ("other-issue") and lifecycle state ("working").
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.data.issueId).toBe("issue-1");
  });

  test("fix_case: mismatched issueId falls back to a fresh actor with a warning", async () => {
    const snap = await buildWorkingSnapshot("other-issue");
    await writeInlineSnapshot(snap);

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
    expect(actor.getSnapshot().context.data.issueId).toBe("issue-1");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("issue-1");
    expect(warn.mock.calls[0]?.[0]).toContain("other-issue");
  });

  test("bug_case (inverted): an unknown-state fallback is no longer silent", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot({ ...snap, value: "no-such-state" });

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    // The fallback itself already worked pre-fix (XState rejected the
    // snapshot via an async throw), but nothing was logged — the reset was
    // invisible and the rejection escaped as an unhandled error.
    expect(actor.getSnapshot().value).toBe("idle");
    expect(warn).toHaveBeenCalled();
  });

  test("fix_case: a snapshot with an unknown state value falls back with a warning", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot({ ...snap, value: "no-such-state" });

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("idle");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("no-such-state");
  });

  test("fix_case: a valid matching snapshot still rehydrates without warnings", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot(snap);

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("working");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("FlowActorStore dual-shape snapshot migration", () => {
  /** A snapshot carrying BOTH legacy top-level context fields and the new
   *  `context.data` structure — the ambiguous shape the migration silently
   *  resolves in favor of `context.data`. */
  async function buildDualShapeSnapshot(key: string): Promise<unknown> {
    const snap = await buildWorkingSnapshot(key);
    return {
      ...snap,
      context: { ...snap.context.data, data: snap.context.data },
    };
  }

  test("bug_case (inverted): dual-shape migration is no longer silent", async () => {
    await writeInlineSnapshot(await buildDualShapeSnapshot("issue-1"));

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("working");
    expect(warn).toHaveBeenCalled();
  });

  test("fix_case: dual-shape snapshot warns that context.data is preferred", async () => {
    await writeInlineSnapshot(await buildDualShapeSnapshot("issue-1"));

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    // The migration outcome is unchanged — context.data wins...
    expect(actor.getSnapshot().value).toBe("working");
    expect(actor.getSnapshot().context.data.issueId).toBe("issue-1");
    // ...but the ambiguity is no longer silent.
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test("fix_case: a pure legacy snapshot (no context.data) migrates without the dual-shape warning", async () => {
    const snap = await buildWorkingSnapshot("issue-1");
    await writeInlineSnapshot({ ...snap, context: { ...snap.context.data } });

    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    const actor = await store.getActor("issue-1", tmpDir);
    expect(actor.getSnapshot().value).toBe("working");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("FlowActorStore persistActor on an unknown key", () => {
  test("bug_case (inverted): no longer returns silently when no actor is registered", async () => {
    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    await store.persistActor("nonexistent", tmpDir);
    expect(warn).toHaveBeenCalled();
  });

  test("fix_case: warns when no actor is registered so callers do not assume a save", async () => {
    const warn = mock((_message: string) => {});
    const store = new FlowActorStore(makeDeps(warn));
    await store.persistActor("nonexistent", tmpDir);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("nonexistent");
    // And nothing was written to disk.
    expect(await Bun.file(join(tmpDir, ".ralph-state.flow.json")).exists()).toBe(false);
  });
});
