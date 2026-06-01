import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnershipError, writeField, slotSidecarPath } from "../state/store";

let changeDir: string;
let statePath: string;

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), "state-store-"));
  statePath = join(changeDir, ".ralph-state.json");
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

/** Read a slot's sidecar file contents (or undefined when absent). */
async function readSidecar(slot: string): Promise<Record<string, unknown> | undefined> {
  const f = Bun.file(slotSidecarPath(changeDir, slot));
  if (!(await f.exists())) return undefined;
  return JSON.parse(await f.text()) as Record<string, unknown>;
}

describe("writeField", () => {
  test("writes to the slot sidecar, never the core .ralph-state.json", async () => {
    writeFileSync(statePath, JSON.stringify({ iteration: 7, status: "active" }));
    await writeField(changeDir, "linear-attachments", "specAttachments.proposal", {
      attachmentId: "att-1",
      sha256: "h",
    });
    // Core file is left exactly as it was — the loop's fields are untouched.
    const core = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
    expect(core).toEqual({ iteration: 7, status: "active" });
    // The slot lives in its own sidecar.
    expect(await readSidecar("specAttachments")).toEqual({
      proposal: { attachmentId: "att-1", sha256: "h" },
    });
  });

  test("non-owner throws OwnershipError and writes nothing", async () => {
    await expect(
      writeField(changeDir, "linear-comments", "specAttachments.proposal", { attachmentId: "b" }),
    ).rejects.toBeInstanceOf(OwnershipError);
    expect(await readSidecar("specAttachments")).toBeUndefined();
  });

  test("unregistered feature name throws OwnershipError", async () => {
    await expect(
      writeField(changeDir, "bogus-feature", "specAttachments.proposal", {}),
    ).rejects.toBeInstanceOf(OwnershipError);
  });

  test("writing a slot with no pre-existing file creates the sidecar", async () => {
    expect(await Bun.file(statePath).exists()).toBe(false);
    await writeField(
      changeDir,
      "review-followup",
      "review.lastConsumedCommentAt",
      "2026-05-15T10:00:00Z",
    );
    expect(await readSidecar("review")).toEqual({ lastConsumedCommentAt: "2026-05-15T10:00:00Z" });
    // The core file is not created as a side effect of a slot write.
    expect(await Bun.file(statePath).exists()).toBe(false);
  });

  test("migrates a pre-existing inline slot value into the sidecar on first write", async () => {
    // Legacy layout: specAttachments lived inline in the core file with a
    // sibling field. The first sidecar write must preserve that sibling.
    writeFileSync(
      statePath,
      JSON.stringify({
        iteration: 3,
        specAttachments: { legacyProposalPurged: true, design: { attachmentId: "old" } },
      }),
    );
    await writeField(changeDir, "linear-attachments", "specAttachments.design", {
      attachmentId: "new",
      sha256: "h",
    });
    expect(await readSidecar("specAttachments")).toEqual({
      legacyProposalPurged: true,
      design: { attachmentId: "new", sha256: "h" },
    });
  });

  test("creates the changeDir if missing", async () => {
    const nested = join(changeDir, "nested", "deep");
    mkdirSync(join(changeDir, "nested"), { recursive: true });
    await writeField(nested, "review-followup", "review.lastConsumedCommentAt", "x");
    const after = JSON.parse(await Bun.file(slotSidecarPath(nested, "review")).text()) as Record<
      string,
      unknown
    >;
    expect(after).toEqual({ lastConsumedCommentAt: "x" });
  });
});
