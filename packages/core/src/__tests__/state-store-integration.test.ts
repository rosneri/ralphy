/**
 * Integration tests for the state store — RLF-110 scenarios S5.1–S5.5,
 * re-expressed against the per-slot sidecar layout (each owned slot lives in
 * its own `.ralph-state.<slot>.json`, so single-writer isolation is now a
 * structural property rather than a read-merge-write convention).
 *
 * S5.1: Single-writer-per-field isolation
 * S5.2: Core-file fields are untouched by slot writes
 * S5.3: Corruption recovery (bad JSON handled gracefully)
 * S5.4: External mutation cannot clobber across files (the LIT-379 fix)
 * S5.5: All registered feature slots coexist without interference
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnershipError, writeField, slotSidecarPath } from "../state/store";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { tryReadStateRaw } from "../state";

let changeDir: string;
let statePath: string;
const withStorage = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), "state-store-integration-"));
  statePath = join(changeDir, ".ralph-state.json");
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

/** Read a slot's sidecar subtree (or undefined when absent). */
async function slot(name: string): Promise<Record<string, unknown> | undefined> {
  const f = Bun.file(slotSidecarPath(changeDir, name));
  if (!(await f.exists())) return undefined;
  return JSON.parse(await f.text()) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// S5.1 — Single-writer-per-field isolation
// ---------------------------------------------------------------------------

describe("S5.1 — single-writer-per-field isolation", () => {
  test("two owners write to different slots and each lands in its own sidecar", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "att-1",
    });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");

    expect((await slot("specAttachments"))!.proposal).toEqual({ attachmentId: "att-1" });
    expect((await slot("linearComments"))!.planCommentId).toBe("c-1");
  });

  test("owner can overwrite its own slot without touching other slots", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "v1",
    });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "v2",
    });

    expect((await slot("specAttachments"))!.proposal).toEqual({ attachmentId: "v2" });
    expect((await slot("linearComments"))!.planCommentId).toBe("c-1");
  });

  test("non-owner write to another feature's slot throws and writes nothing", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "safe",
    });
    const before = await Bun.file(slotSidecarPath(changeDir, "specAttachments")).text();

    await expect(
      writeField(changeDir, "linear-comments", "specAttachments.proposal", {
        attachmentId: "injected",
      }),
    ).rejects.toBeInstanceOf(OwnershipError);

    expect(await Bun.file(slotSidecarPath(changeDir, "specAttachments")).text()).toBe(before);
  });

  test("unregistered feature name throws OwnershipError before touching disk", async () => {
    await expect(
      writeField(changeDir, "ghost-feature", "specAttachments.proposal", {}),
    ).rejects.toBeInstanceOf(OwnershipError);
    expect(await slot("specAttachments")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S5.2 — Core-file fields are untouched by slot writes
// ---------------------------------------------------------------------------

describe("S5.2 — core file is never mutated by a slot write", () => {
  test("unrelated core fields survive a writeField round-trip verbatim", async () => {
    const core = JSON.stringify({
      iteration: 4,
      status: "active",
      legacyField: "preserved",
      futureFeature: { nested: true },
    });
    writeFileSync(statePath, core);
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "new",
    });
    // Byte-for-byte unchanged — writeField never opens the core file for write.
    expect(await Bun.file(statePath).text()).toBe(core);
    expect((await slot("specAttachments"))!.proposal).toEqual({ attachmentId: "new" });
  });
});

// ---------------------------------------------------------------------------
// S5.3 — Corruption recovery
// ---------------------------------------------------------------------------

describe("S5.3 — corruption recovery", () => {
  test("tryReadStateRaw returns null for both state and raw when JSON is invalid", () =>
    withStorage(() => {
      writeFileSync(statePath, "{ corrupted json !!!", "utf-8");
      const result = tryReadStateRaw(changeDir);
      expect(result.state).toBeNull();
      expect(result.raw).toBeNull();
    }));

  test("tryReadStateRaw returns null state but non-null raw for schema-invalid JSON", () =>
    withStorage(() => {
      writeFileSync(
        statePath,
        JSON.stringify({ completely: "wrong-shape", missing: "required-fields" }),
        "utf-8",
      );
      const result = tryReadStateRaw(changeDir);
      expect(result.state).toBeNull();
      expect(result.raw).not.toBeNull();
      expect((result.raw as Record<string, unknown>).completely).toBe("wrong-shape");
    }));

  test("writeField succeeds even when the core file is corrupt (sidecar is independent)", async () => {
    writeFileSync(statePath, "not valid json at all {{{{", "utf-8");
    await writeField(changeDir, "review-followup", "review.lastConsumedCommentAt", "2026-01-01");
    expect((await slot("review"))!.lastConsumedCommentAt).toBe("2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// S5.4 — External mutation cannot clobber across files (the LIT-379 fix)
// ---------------------------------------------------------------------------

describe("S5.4 — cross-file isolation under external mutation", () => {
  test("an external whole-file rewrite of the core file leaves sidecar slots intact", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.design", { v: 2 });

    // Simulate the loop (or any process) rewriting the entire core file with
    // no knowledge of the slot. Under the old single-file layout this erased
    // the slot; now the slot lives in a separate file and survives.
    writeFileSync(statePath, JSON.stringify({ iteration: 99, status: "active" }));

    expect((await slot("specAttachments"))!.design).toEqual({ v: 2 });
  });

  test("a slot write does not resurrect or clobber the core file", async () => {
    writeFileSync(statePath, JSON.stringify({ iteration: 1 }));
    await writeField(changeDir, "confirmation", "confirmation.askedAt", "2026-01-01");
    // Core file unchanged; confirmation isolated in its sidecar.
    expect(JSON.parse(await Bun.file(statePath).text())).toEqual({ iteration: 1 });
    expect((await slot("confirmation"))!.askedAt).toBe("2026-01-01");
  });
});

// ---------------------------------------------------------------------------
// S5.5 — All registered feature slots coexist without interference
// ---------------------------------------------------------------------------

describe("S5.5 — all registered feature slots accumulate correctly", () => {
  test("every registered feature writes to its own sidecar independently", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { id: "p" });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c1");
    await writeField(changeDir, "confirmation", "confirmation.askedAt", "2026-01-01");
    await writeField(changeDir, "review-followup", "review.lastConsumedCommentAt", "2026-01-02");
    await writeField(changeDir, "ci-fix", "ci.lastRunId", "run-1");
    await writeField(changeDir, "implement", "pr.number", 42);

    expect((await slot("specAttachments"))!.proposal).toEqual({ id: "p" });
    expect((await slot("linearComments"))!.planCommentId).toBe("c1");
    expect((await slot("confirmation"))!.askedAt).toBe("2026-01-01");
    expect((await slot("review"))!.lastConsumedCommentAt).toBe("2026-01-02");
    expect((await slot("ci"))!.lastRunId).toBe("run-1");
    expect((await slot("pr"))!.number).toBe(42);
  });

  test("interleaved writes from multiple features all land correctly", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { v: "a1" });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c1");
    await writeField(changeDir, "linear-attachments", "specAttachments.design", { v: "a2" });
    await writeField(changeDir, "confirmation", "confirmation.confirmedAt", "2026-02-01");
    await writeField(changeDir, "linear-comments", "linearComments.lastSyncAt", "2026-02-02");

    const specAttachments = await slot("specAttachments");
    const linearComments = await slot("linearComments");
    expect(specAttachments!.proposal).toEqual({ v: "a1" });
    expect(specAttachments!.design).toEqual({ v: "a2" });
    expect(linearComments!.planCommentId).toBe("c1");
    expect(linearComments!.lastSyncAt).toBe("2026-02-02");
    expect((await slot("confirmation"))!.confirmedAt).toBe("2026-02-01");
  });
});
