import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  syncSpecAttachments,
  type SpecAttachmentMutations,
} from "../agent/linear-sync/spec-attachments";

let tempDir: string;
let changeDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spec-attachments-design-only-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  statePath = join(tempDir, ".ralph", "tasks", "demo", ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface UploadCall {
  filename: string;
  bytes: Uint8Array;
}
interface CreateCall {
  issueId: string;
  url: string;
  title: string;
  subtitle?: string;
}

interface FakeMutations extends SpecAttachmentMutations {
  uploads: UploadCall[];
  creates: CreateCall[];
  deletes: { attachmentId: string }[];
  attachmentsByTitle: Map<string, string>;
}

function makeMutations(): FakeMutations {
  let nextId = 1;
  const m: FakeMutations = {
    uploads: [],
    creates: [],
    deletes: [],
    attachmentsByTitle: new Map(),
    uploadFileToLinear: async (_apiKey, input) => {
      m.uploads.push({ filename: input.filename, bytes: input.bytes });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${nextId++}` };
    },
    createAttachmentForUrl: async (_apiKey, input) => {
      m.creates.push(input);
      const id = `att-${nextId++}`;
      m.attachmentsByTitle.set(input.title, id);
      return id;
    },
    deleteAttachment: async (_apiKey, attachmentId) => {
      m.deletes.push({ attachmentId });
      for (const [title, id] of m.attachmentsByTitle) {
        if (id === attachmentId) m.attachmentsByTitle.delete(title);
      }
    },
    findIssueAttachmentByTitle: async (_apiKey, _issueId, title) =>
      m.attachmentsByTitle.get(title) ?? null,
  };
  return m;
}

const noopLog = (_t: string, _c?: string): void => {};

function writeProposal(text = "# proposal\n\nproposal body content here.\n"): void {
  writeFileSync(join(changeDir, "proposal.md"), text);
}
function writeDesign(text = "# design\n\ndesign body content here.\n"): void {
  writeFileSync(join(changeDir, "design.md"), text);
}
function writeTasks(
  text = "# Tasks for demo\n\n## Planning\n\n- [ ] plan the work\n\n## Implementation\n\n- [ ] task one\n- [ ] task two\n",
): void {
  writeFileSync(join(changeDir, "tasks.md"), text);
}

describe("syncSpecAttachments — upload design (with tasks) only, drop proposal", () => {
  // fix_case: with the new behavior, no upload should be filenamed "proposal.md",
  // the design upload should contain both design.md content and tasks.md content,
  // and an existing proposal attachment recorded in state should be deleted.
  test("fix_case: uploads only design.md (with tasks embedded) and purges legacy proposal attachment", async () => {
    writeProposal("# proposal\n\nproposal prose.\n");
    writeDesign("# design\n\ndesign prose.\n");
    writeTasks(
      "# Tasks for demo\n\n## Planning\n\n- [ ] plan the work\n\n## Implementation\n\n- [ ] do thing\n- [ ] do other thing\n",
    );

    // Pre-seed state as if a previous run had uploaded a proposal attachment.
    mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        specAttachments: {
          proposal: { attachmentId: "att-legacy-proposal", sha256: "deadbeef" },
        },
      }),
    );

    const m = makeMutations();
    m.attachmentsByTitle.set("Ralph proposal", "att-legacy-proposal");

    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: noopLog,
      mutations: m,
    });

    // No proposal.md upload happens.
    expect(m.uploads.some((u) => u.filename === "proposal.md")).toBe(false);

    // Exactly one design.md upload, and its bytes embed both the design and the tasks content.
    const designUploads = m.uploads.filter((u) => u.filename === "design.md");
    expect(designUploads).toHaveLength(1);
    const designText = new TextDecoder().decode(designUploads[0]!.bytes);
    expect(designText).toContain("design prose.");
    expect(designText).toContain("do thing");
    expect(designText).toContain("do other thing");
    // Only the Implementation tasks are embedded — never the Planning checklist.
    expect(designText).not.toContain("## Planning");
    expect(designText).not.toContain("plan the work");

    // Legacy proposal attachment in state is deleted from Linear.
    expect(m.deletes.map((d) => d.attachmentId)).toContain("att-legacy-proposal");
  });

  // Regression guard (formerly bug_case): the broken behavior was uploading
  // proposal.md as its own attachment. After the fix, proposal.md must NEVER
  // be uploaded — design.md is the only markdown payload.
  test("regression: proposal.md is never uploaded as its own attachment", async () => {
    writeProposal();
    writeDesign();
    writeTasks();
    const m = makeMutations();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: noopLog,
      mutations: m,
    });
    expect(m.uploads.some((u) => u.filename === "proposal.md")).toBe(false);
    expect(m.creates.some((c) => c.title === "Ralph proposal")).toBe(false);
  });
});
