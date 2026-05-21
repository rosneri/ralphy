import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnershipError, writeField } from "../state/store";

let changeDir: string;
let statePath: string;

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), "state-store-"));
  statePath = join(changeDir, ".ralph-state.json");
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe("writeField", () => {
  test("owner writes succeed and preserve unrelated slots", async () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        linearComments: { planCommentId: "c-1" },
        confirmation: { askedAt: "2026-01-01T00:00:00Z" },
      }),
    );
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "att-1",
      sha256: "h",
    });
    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(after.linearComments).toEqual({ planCommentId: "c-1" });
    expect(after.confirmation).toEqual({ askedAt: "2026-01-01T00:00:00Z" });
    expect(after.specAttachments).toEqual({ proposal: { attachmentId: "att-1", sha256: "h" } });
  });

  test("non-owner throws OwnershipError and leaves the file untouched", async () => {
    const before = JSON.stringify({ specAttachments: { proposal: { attachmentId: "a" } } });
    writeFileSync(statePath, before);
    await expect(
      writeField(changeDir, "linear-comments", "specAttachments.proposal", { attachmentId: "b" }),
    ).rejects.toBeInstanceOf(OwnershipError);
    const after = await Bun.file(statePath).text();
    expect(after).toBe(before);
  });

  test("unregistered feature name throws OwnershipError", async () => {
    await expect(
      writeField(changeDir, "bogus-feature", "specAttachments.proposal", {}),
    ).rejects.toBeInstanceOf(OwnershipError);
  });

  test("writing into a slot the file doesn't yet contain creates the parent object", async () => {
    // No file on disk yet.
    expect(await Bun.file(statePath).exists()).toBe(false);
    await writeField(
      changeDir,
      "review-followup",
      "review.lastConsumedCommentAt",
      "2026-05-15T10:00:00Z",
    );
    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(after.review).toEqual({ lastConsumedCommentAt: "2026-05-15T10:00:00Z" });
  });

  test("creates a nested parent when the slot is missing on an existing file", async () => {
    writeFileSync(statePath, JSON.stringify({ unrelated: 1 }));
    await writeField(changeDir, "linear-attachments", "specAttachments.designPdf", {
      attachmentId: "att-pdf",
      sha256: null,
    });
    const after = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(after.unrelated).toBe(1);
    expect((after.specAttachments as Record<string, unknown>).designPdf).toEqual({
      attachmentId: "att-pdf",
      sha256: null,
    });
  });

  test("creates the changeDir if missing", async () => {
    const nested = join(changeDir, "nested", "deep");
    mkdirSync(join(changeDir, "nested"), { recursive: true });
    // nested/deep does not exist yet; writeField should `mkdir -p` it.
    await writeField(nested, "review-followup", "review.lastConsumedCommentAt", "x");
    const after = JSON.parse(await Bun.file(join(nested, ".ralph-state.json")).text()) as Record<
      string,
      unknown
    >;
    expect(after.review).toEqual({ lastConsumedCommentAt: "x" });
  });
});
