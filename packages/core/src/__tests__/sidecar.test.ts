/**
 * Sidecar state layer — the fix for the cross-process lost-update that
 * truncated `.ralph-state.json` to a 64-byte
 * `{ "specAttachments": { "legacyProposalPurged": true } }` and erased the
 * loop's iteration / status / confirmation for five LIT changes.
 *
 * The guarantee under test: a feature-owned slot (written via `writeField`
 * from the agent main process) and the loop's core state (written via
 * `writeState`) live in separate files, so neither can clobber the other no
 * matter the interleaving — and a read composes them back together.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWithContext, createDefaultContext } from "@ralphy/context";
import { writeField, slotSidecarPath } from "../state/store";
import { readSlotSidecar, writeSlotField } from "../state/sidecar";
import { readState, writeState, tryReadStateRaw, buildInitialState } from "../state";

let changeDir: string;
let statePath: string;
const withStorage = <T>(fn: () => T): T => runWithContext(createDefaultContext(), fn);

beforeEach(() => {
  changeDir = mkdtempSync(join(tmpdir(), "sidecar-"));
  statePath = join(changeDir, ".ralph-state.json");
});

afterEach(() => {
  rmSync(changeDir, { recursive: true, force: true });
});

describe("no cross-writer clobber (the LIT-379 bug)", () => {
  test("a slot write cannot erase the loop's core state, in either order", () =>
    withStorage(async () => {
      // Loop writes full state (iteration etc.).
      const s = buildInitialState({ name: "lit-379", prompt: "model the cascade" });
      writeState(changeDir, { ...s, iteration: 5, status: "active" });

      // Agent main process writes the design attachment slot.
      await writeField(changeDir, "linear-attachments", "specAttachments.design", {
        attachmentId: "att-design",
        sha256: "abc",
      });

      // Loop writes again (e.g. iteration bump) — this used to read a stale
      // snapshot and truncate the file. Now it only touches the core file.
      writeState(changeDir, { ...s, iteration: 6, status: "active" });

      const read = readState(changeDir);
      // Loop fields survive...
      expect(read.iteration).toBe(6);
      expect(read.status).toBe("active");
      // ...and so does the slot the main process wrote.
      expect(read.specAttachments.design.attachmentId).toBe("att-design");
    }));

  test("writeState strips owned slots from the core file (they live in sidecars)", () =>
    withStorage(async () => {
      await writeField(changeDir, "linear-comments", "linearComments.planCommentId", "c-1");
      const s = buildInitialState({ name: "x", prompt: "p" });
      writeState(changeDir, s);

      const core = JSON.parse(await Bun.file(statePath).text()) as Record<string, unknown>;
      expect(core.linearComments).toBeUndefined();
      expect(core.specAttachments).toBeUndefined();
      expect(core.confirmation).toBeUndefined();
      // But a read still surfaces the sidecar-written slot.
      expect(readState(changeDir).linearComments.planCommentId).toBe("c-1");
    }));
});

describe("overlay precedence", () => {
  test("the sidecar wins over a stale inline copy left in the core file", () =>
    withStorage(async () => {
      // Stale inline value (legacy layout) in the core file.
      const s = buildInitialState({ name: "x", prompt: "p" });
      writeFileSync(
        statePath,
        JSON.stringify({
          ...s,
          confirmation: { askedAt: "STALE", lastReminderAt: null, confirmedAt: null, rounds: 0 },
        }),
      );
      // Fresh value in the sidecar.
      await writeField(changeDir, "confirmation", "confirmation", {
        askedAt: "FRESH",
        lastReminderAt: null,
        confirmedAt: null,
        rounds: 1,
      });

      expect(readState(changeDir).confirmation.askedAt).toBe("FRESH");
      expect(readState(changeDir).confirmation.rounds).toBe(1);
    }));

  test("tryReadStateRaw overlays out-of-schema slots (ci/pr/flow) onto raw", () =>
    withStorage(async () => {
      const s = buildInitialState({ name: "x", prompt: "p" });
      writeState(changeDir, s);
      await writeField(changeDir, "ci-fix", "ci.lastCheckedAt", "2026-06-01T00:00:00Z");
      await writeField(changeDir, "implement", "pr.url", "https://example/pr/1");

      const { raw } = tryReadStateRaw(changeDir);
      expect(raw).not.toBeNull();
      expect((raw!.ci as Record<string, unknown>).lastCheckedAt).toBe("2026-06-01T00:00:00Z");
      expect((raw!.pr as Record<string, unknown>).url).toBe("https://example/pr/1");
    }));
});

describe("migration fallback", () => {
  test("readState uses the inline slot when no sidecar exists yet", () =>
    withStorage(() => {
      const s = buildInitialState({ name: "x", prompt: "p" });
      writeFileSync(
        statePath,
        JSON.stringify({
          ...s,
          specAttachments: {
            proposal: { attachmentId: null, sha256: null },
            design: { attachmentId: "inline-design", sha256: "h" },
            proposalPdf: { attachmentId: null, sha256: null },
            designPdf: { attachmentId: null, sha256: null },
            legacyProposalPurged: true,
          },
        }),
      );
      expect(existsSync(slotSidecarPath(changeDir, "specAttachments"))).toBe(false);
      // No sidecar → inline value is used.
      expect(readState(changeDir).specAttachments.design.attachmentId).toBe("inline-design");
    }));
});

describe("sidecar read/write internals", () => {
  test("readSlotSidecar returns undefined when the sidecar holds invalid JSON", async () => {
    writeFileSync(slotSidecarPath(changeDir, "flow"), "{ not json");
    expect(await readSlotSidecar(changeDir, "flow")).toBeUndefined();
  });

  test("readSlotSidecar returns undefined when the sidecar holds a non-object (array)", async () => {
    writeFileSync(slotSidecarPath(changeDir, "flow"), JSON.stringify([1, 2, 3]));
    expect(await readSlotSidecar(changeDir, "flow")).toBeUndefined();
  });

  test("writeSlotField creates nested intermediates and descends into existing ones", async () => {
    await writeSlotField(changeDir, "flow.a.b", 1);
    // `a` now exists as an object → the second write must descend, not clobber.
    await writeSlotField(changeDir, "flow.a.c", 2);
    expect(await readSlotSidecar(changeDir, "flow")).toEqual({ a: { b: 1, c: 2 } });
  });

  test("writeSlotField replaces a non-object intermediate with a fresh object", async () => {
    await writeSlotField(changeDir, "flow.x", "scalar");
    await writeSlotField(changeDir, "flow.x.y", 9);
    expect(await readSlotSidecar(changeDir, "flow")).toEqual({ x: { y: 9 } });
  });

  // Skipped under root, where file permissions are ignored and the read succeeds.
  test.skipIf(process.getuid?.() === 0)(
    "readSlotSidecar returns undefined when the sidecar exists but cannot be read",
    async () => {
      const path = slotSidecarPath(changeDir, "flow");
      writeFileSync(path, '{"a":1}');
      chmodSync(path, 0o000);
      try {
        expect(await readSlotSidecar(changeDir, "flow")).toBeUndefined();
      } finally {
        chmodSync(path, 0o600); // restore so afterEach cleanup can remove it
      }
    },
  );

  test("writeSlotField rejects and leaves no temp file when the rename target is unwritable", async () => {
    // Occupy the sidecar path with a directory so the atomic rename fails.
    mkdirSync(slotSidecarPath(changeDir, "flow"));
    await expect(writeSlotField(changeDir, "flow", { a: 1 })).rejects.toThrow();
    expect(readdirSync(changeDir).filter((f) => f.includes(".tmp-"))).toHaveLength(0);
  });
});
