/**
 * Integration tests for the state store — covers RLF-110 scenarios S5.1–S5.5.
 *
 * S5.1: Single-writer-per-field isolation
 * S5.2: Schema-drift tolerance (extra/unknown fields survive round-trips)
 * S5.3: Corruption recovery (bad JSON handled gracefully)
 * S5.4: External mutation between reads (simulates direct disk writes between iterations)
 * S5.5: All registered feature slots coexist without interference
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnershipError, writeField } from "../state/store";
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

// ---------------------------------------------------------------------------
// S5.1 — Single-writer-per-field isolation
// ---------------------------------------------------------------------------

describe("S5.1 — single-writer-per-field isolation", () => {
  test("two owners write to different slots sequentially and neither stomps the other", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "att-1",
    });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");

    const state = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((state.specAttachments as Record<string, unknown>).proposal).toEqual({
      attachmentId: "att-1",
    });
    expect((state.linearComments as Record<string, unknown>).planCommentId).toBe("c-1");
  });

  test("owner can overwrite its own slot without touching other slots", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "v1",
    });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "v2",
    });

    const state = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((state.specAttachments as Record<string, unknown>).proposal).toEqual({
      attachmentId: "v2",
    });
    expect((state.linearComments as Record<string, unknown>).planCommentId).toBe("c-1");
  });

  test("non-owner write to another feature's top-level slot throws and leaves disk unchanged", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "safe",
    });
    const before = await Bun.file(statePath).text();

    await expect(
      writeField(changeDir, "linear-comments", "specAttachments.proposal", {
        attachmentId: "injected",
      }),
    ).rejects.toBeInstanceOf(OwnershipError);

    expect(await Bun.file(statePath).text()).toBe(before);
  });

  test("unregistered feature name throws OwnershipError before touching disk", async () => {
    writeFileSync(statePath, JSON.stringify({ specAttachments: { existing: true } }));
    const before = await Bun.file(statePath).text();

    await expect(
      writeField(changeDir, "ghost-feature", "specAttachments.proposal", {}),
    ).rejects.toBeInstanceOf(OwnershipError);

    expect(await Bun.file(statePath).text()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// S5.2 — Schema-drift tolerance
// ---------------------------------------------------------------------------

describe("S5.2 — schema drift tolerance", () => {
  test("unknown top-level fields survive a writeField round-trip", async () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        legacyField: "preserved",
        futureFeature: { nested: true },
        specAttachments: { old: "value" },
      }),
    );
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "new",
    });

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(after.legacyField).toBe("preserved");
    expect((after.futureFeature as Record<string, unknown>).nested).toBe(true);
    expect((after.specAttachments as Record<string, unknown>).proposal).toEqual({
      attachmentId: "new",
    });
  });

  test("multiple unknown fields are all preserved across multiple writeField calls", async () => {
    writeFileSync(statePath, JSON.stringify({ alpha: 1, beta: "two", gamma: [3, 4] }));
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");
    await writeField(changeDir, "confirmation", "confirmation.askedAt", "2026-01-01");

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(after.alpha).toBe(1);
    expect(after.beta).toBe("two");
    expect(after.gamma).toEqual([3, 4]);
  });
});

// ---------------------------------------------------------------------------
// S5.3 — Corruption recovery
// ---------------------------------------------------------------------------

describe("S5.3 — corruption recovery", () => {
  test("tryReadStateRaw returns null for both state and raw when JSON is syntactically invalid", () =>
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

  test("writeField on a corrupted file silently re-initialises and writes the field", async () => {
    writeFileSync(statePath, "not valid json at all {{{{", "utf-8");

    await writeField(changeDir, "review-followup", "review.lastConsumedCommentAt", "2026-01-01");

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.review as Record<string, unknown>).lastConsumedCommentAt).toBe("2026-01-01");
  });

  test("writeField on a truncated JSON file (partial write) recovers and writes the new field", async () => {
    writeFileSync(statePath, '{"specAttachments": {"prop', "utf-8");

    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.linearComments as Record<string, unknown>).planCommentId).toBe("c-1");
  });
});

// ---------------------------------------------------------------------------
// S5.4 — External mutation between reads (simulates cross-iteration direct writes)
// ---------------------------------------------------------------------------

describe("S5.4 — external mutation between reads", () => {
  test("directly-mutated .ralph-state.json is visible to the next writeField call", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { v: 1 });

    // Simulate an external process (e.g. linear-sync) writing directly to disk.
    writeFileSync(
      statePath,
      JSON.stringify({
        specAttachments: { proposal: { v: 1 } },
        confirmation: { externallySet: true },
      }),
    );

    // The next owned write should preserve the externally-added slot.
    await writeField(changeDir, "linear-attachments", "specAttachments.design", { v: 2 });

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.specAttachments as Record<string, unknown>).proposal).toEqual({ v: 1 });
    expect((after.specAttachments as Record<string, unknown>).design).toEqual({ v: 2 });
    expect((after.confirmation as Record<string, unknown>).externallySet).toBe(true);
  });

  test("external deletion of the state file is handled gracefully on next write", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { v: 1 });

    // Simulate file being deleted externally.
    rmSync(statePath);
    expect(await Bun.file(statePath).exists()).toBe(false);

    // Next write should recreate from scratch.
    await writeField(changeDir, "confirmation", "confirmation.askedAt", "2026-01-01");

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.confirmation as Record<string, unknown>).askedAt).toBe("2026-01-01");
    // The previously-written slot is gone (file was deleted externally).
    expect(after.specAttachments).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S5.5 — All registered feature slots coexist without interference
// ---------------------------------------------------------------------------

describe("S5.5 — all registered feature slots accumulate correctly", () => {
  test("every registered feature can write to its own slot independently", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { id: "p" });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c1");
    await writeField(changeDir, "confirmation", "confirmation.askedAt", "2026-01-01");
    await writeField(changeDir, "review-followup", "review.lastConsumedCommentAt", "2026-01-02");
    await writeField(changeDir, "ci-fix", "ci.lastRunId", "run-1");
    await writeField(changeDir, "implement", "pr.number", 42);

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.specAttachments as Record<string, unknown>).proposal).toEqual({ id: "p" });
    expect((after.linearComments as Record<string, unknown>).planCommentId).toBe("c1");
    expect((after.confirmation as Record<string, unknown>).askedAt).toBe("2026-01-01");
    expect((after.review as Record<string, unknown>).lastConsumedCommentAt).toBe("2026-01-02");
    expect((after.ci as Record<string, unknown>).lastRunId).toBe("run-1");
    expect((after.pr as Record<string, unknown>).number).toBe(42);
  });

  test("interleaved writes from multiple features all land correctly", async () => {
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", { v: "a1" });
    await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c1");
    await writeField(changeDir, "linear-attachments", "specAttachments.design", { v: "a2" });
    await writeField(changeDir, "confirmation", "confirmation.confirmedAt", "2026-02-01");
    await writeField(changeDir, "linear-comments", "linearComments.lastSyncAt", "2026-02-02");

    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect((after.specAttachments as Record<string, unknown>).proposal).toEqual({ v: "a1" });
    expect((after.specAttachments as Record<string, unknown>).design).toEqual({ v: "a2" });
    expect((after.linearComments as Record<string, unknown>).planCommentId).toBe("c1");
    expect((after.linearComments as Record<string, unknown>).lastSyncAt).toBe("2026-02-02");
    expect((after.confirmation as Record<string, unknown>).confirmedAt).toBe("2026-02-01");
  });
});
