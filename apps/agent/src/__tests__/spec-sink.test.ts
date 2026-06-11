import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinearSpecSink } from "../agent/linear-sync/spec-sink";
import type { SpecAttachmentMutations } from "../agent/linear-sync/spec-attachments";

let tempDir: string;
let changeDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spec-sink-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  statePath = join(tempDir, ".ralph", "tasks", "demo", ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
  mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface FakeMutations extends SpecAttachmentMutations {
  uploads: { filename: string }[];
  creates: { title: string }[];
}

function makeMutations(): FakeMutations {
  let n = 1;
  const m: FakeMutations = {
    uploads: [],
    creates: [],
    uploadFileToLinear: async (_k, input) => {
      m.uploads.push({ filename: input.filename });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${n++}` };
    },
    createAttachmentForUrl: async (_k, input) => {
      m.creates.push({ title: input.title });
      return `att-${n++}`;
    },
    deleteAttachment: async () => {},
    findIssueAttachmentByTitle: async () => null,
  };
  return m;
}

describe("createLinearSpecSink", () => {
  test("sync delegates to syncSpecAttachments with mapped deps", async () => {
    writeFileSync(join(changeDir, "design.md"), "# Design\n\nReal design content.\n", "utf-8");
    writeFileSync(join(changeDir, "tasks.md"), "## Implementation\n\n- [ ] task\n", "utf-8");
    const mutations = makeMutations();
    const sink = createLinearSpecSink({ apiKey: "k", mutations });

    await sink.sync({ issueId: "issue-1", statePath, changeDir, iteration: 3, log: () => {} });

    // Delegation proof: the design slot was uploaded + an attachment created
    // through the injected mutations.
    expect(mutations.uploads).toHaveLength(1);
    expect(mutations.uploads[0]!.filename).toBe("design.md");
    expect(mutations.creates.some((c) => c.title === "Ralph design")).toBe(true);
  });

  test("formats option flows through to the attachment slots", async () => {
    writeFileSync(join(changeDir, "design.md"), "# Design\n\nReal design content.\n", "utf-8");
    const mutations = makeMutations();
    const sink = createLinearSpecSink({ apiKey: "k", mutations, formats: ["md", "pdf"] });

    await sink.sync({ issueId: "issue-1", statePath, changeDir, iteration: 1, log: () => {} });

    // Both the md and pdf design slots upload when "pdf" is enabled.
    expect(mutations.uploads.map((u) => u.filename).sort()).toEqual(["design.md", "design.pdf"]);
  });

  test("read returns null (attachments are not re-read)", async () => {
    const sink = createLinearSpecSink({ apiKey: "k", mutations: makeMutations() });
    expect(await sink.read({ issueId: "issue-1" })).toBeNull();
  });
});
