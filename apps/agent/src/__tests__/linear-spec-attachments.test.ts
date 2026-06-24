import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  extractImplementationSection,
  syncSpecAttachments,
  type SpecAttachmentMutations,
} from "../agent/linear-sync/spec-attachments";

let tempDir: string;
let changeDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spec-attachments-"));
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
interface DeleteCall {
  attachmentId: string;
}

interface FakeMutations extends SpecAttachmentMutations {
  uploads: UploadCall[];
  creates: CreateCall[];
  deletes: DeleteCall[];
  /** Pre-seeded attachments on the issue, keyed by exact title. */
  attachmentsByTitle: Map<string, string>;
  /** Number of times `findIssueAttachmentByTitle` was invoked. */
  findCalls: number;
  failUploadWith?: Error;
  failCreateWith?: Error;
  failDeleteWith?: Error;
  failFindWith?: Error;
  failNextDeleteWithNotFound: boolean;
}

function makeMutations(initialId = 1): FakeMutations {
  let nextId = initialId;
  const m: FakeMutations = {
    uploads: [],
    creates: [],
    deletes: [],
    attachmentsByTitle: new Map(),
    findCalls: 0,
    failNextDeleteWithNotFound: false,
    uploadFileToLinear: async (_apiKey, input) => {
      if (m.failUploadWith) throw m.failUploadWith;
      m.uploads.push({ filename: input.filename, bytes: input.bytes });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${nextId++}` };
    },
    createAttachmentForUrl: async (_apiKey, input) => {
      if (m.failCreateWith) throw m.failCreateWith;
      m.creates.push(input);
      const id = `att-${nextId++}`;
      m.attachmentsByTitle.set(input.title, id);
      return id;
    },
    deleteAttachment: async (_apiKey, attachmentId) => {
      if (m.failNextDeleteWithNotFound) {
        m.failNextDeleteWithNotFound = false;
        const err = new Error("Linear API returned errors") as Error & { messages?: string[] };
        err.messages = ["Entity not found: Attachment"];
        throw err;
      }
      if (m.failDeleteWith) throw m.failDeleteWith;
      m.deletes.push({ attachmentId });
      for (const [title, id] of m.attachmentsByTitle) {
        if (id === attachmentId) m.attachmentsByTitle.delete(title);
      }
    },
    findIssueAttachmentByTitle: async (_apiKey, _issueId, title) => {
      m.findCalls += 1;
      if (m.failFindWith) throw m.failFindWith;
      return m.attachmentsByTitle.get(title) ?? null;
    },
  };
  return m;
}

function makeLog(): { fn: (text: string, color?: string) => void; entries: string[] } {
  const entries: string[] = [];
  return {
    entries,
    fn: (text: string, color?: string) => {
      entries.push(`${color ?? ""}|${text}`);
    },
  };
}

// specAttachments now lives in its own sidecar (`.ralph-state.specAttachments.json`),
// written single-writer via writeField. Prefer the sidecar; fall back to a
// legacy inline copy in the core file for the migration-seeding cases.
async function readState(): Promise<{ specAttachments?: Record<string, unknown> }> {
  const sidecar = join(dirname(statePath), ".ralph-state.specAttachments.json");
  if (await Bun.file(sidecar).exists()) {
    return {
      specAttachments: JSON.parse(await Bun.file(sidecar).text()) as Record<string, unknown>,
    };
  }
  if (await Bun.file(statePath).exists()) {
    return JSON.parse(await Bun.file(statePath).text()) as {
      specAttachments?: Record<string, unknown>;
    };
  }
  return {};
}

function writeDesign(text = "# design\n\ndesign body content here.\n"): void {
  writeFileSync(join(changeDir, "design.md"), text);
}
function writeTasks(
  text = "# Tasks for demo\n\n## Planning\n\n- [ ] research the codebase\n\n## Implementation\n\n- [ ] task one\n- [ ] task two\n",
): void {
  writeFileSync(join(changeDir, "tasks.md"), text);
}

describe("syncSpecAttachments", () => {
  test("first run uploads design.md (with tasks.md embedded) and persists ids + hashes", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 4,
      log: log.fn,
      mutations: m,
    });
    expect(m.uploads.map((u) => u.filename)).toEqual(["design.md"]);
    const designText = new TextDecoder().decode(m.uploads[0]!.bytes);
    expect(designText).toContain("design body content");
    expect(designText).toContain("task one");
    // Only the `## Implementation` section is embedded — the `## Planning`
    // checklist (agent process tasks) must never reach the attachment.
    expect(designText).not.toContain("## Planning");
    expect(designText).not.toContain("research the codebase");
    expect(m.creates).toHaveLength(1);
    expect(m.deletes).toHaveLength(0);
    const state = await readState();
    const sa = state.specAttachments as {
      design: { attachmentId: string; sha256: string };
    };
    expect(sa.design.attachmentId).toMatch(/^att-/);
    expect(sa.design.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.creates[0]!.subtitle).toBe("iteration 4");
    expect(m.creates[0]!.title).toBe("Ralph design");
  });

  test("unchanged content skips uploads on second run", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    };
    await syncSpecAttachments(deps);
    const baselineUploads = m.uploads.length;
    const baselineCreates = m.creates.length;
    await syncSpecAttachments({ ...deps, iteration: 2 });
    expect(m.uploads.length).toBe(baselineUploads);
    expect(m.creates.length).toBe(baselineCreates);
    expect(m.deletes.length).toBe(0);
  });

  test("unchanged-skip line goes to fileLog, not log, when a file sink is provided", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    const fileLog = makeLog();
    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      fileLog: fileLog.fn,
      mutations: m,
    };
    await syncSpecAttachments(deps);
    log.entries.length = 0;
    fileLog.entries.length = 0;
    await syncSpecAttachments({ ...deps, iteration: 2 });
    // The recurring "unchanged, skipping" line lands in the file sink only —
    // never in the agent-view log.
    expect(fileLog.entries.some((e) => e.includes("unchanged, skipping"))).toBe(true);
    expect(log.entries.some((e) => e.includes("unchanged, skipping"))).toBe(false);
  });

  test("changed content deletes the old attachment and creates a new one (refresh = delete + create)", async () => {
    writeDesign("# design\n\nv1\n");
    writeTasks("- [ ] task v1\n");
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    const before = (await readState()).specAttachments as {
      design: { attachmentId: string };
    };
    writeDesign("# design\n\nv2 — changed\n");
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 2,
      log: log.fn,
      mutations: m,
    });
    expect(m.deletes).toHaveLength(1);
    expect(m.deletes[0]!.attachmentId).toBe(before.design.attachmentId);
    expect(m.creates).toHaveLength(2);
    expect(m.uploads.map((u) => u.filename)).toEqual(["design.md", "design.md"]);
    const after = (await readState()).specAttachments as {
      design: { attachmentId: string };
    };
    expect(after.design.attachmentId).not.toBe(before.design.attachmentId);
  });

  test("missing design.md skips the design slot entirely", async () => {
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.uploads).toHaveLength(0);
    expect(m.creates).toHaveLength(0);
    expect(log.entries.some((e) => e.includes("design.md missing"))).toBe(true);
  });

  test("missing tasks.md still uploads design.md alone (tasks are optional trailing content)", async () => {
    writeDesign("# design\n\nbody only, no tasks present.\n");
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.uploads.map((u) => u.filename)).toEqual(["design.md"]);
    const text = new TextDecoder().decode(m.uploads[0]!.bytes);
    expect(text).toContain("body only");
    expect(text).not.toContain("# tasks.md");
  });

  test("upload error logs yellow and leaves .ralph-state.json untouched", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    m.failUploadWith = new Error("boom");
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.creates).toHaveLength(0);
    expect(log.entries.some((e) => e.startsWith("yellow|") && e.includes("upload"))).toBe(true);
    // State file may exist (purge-marker), but no attachment id is recorded.
    if (await Bun.file(statePath).exists()) {
      const sa = (await readState()).specAttachments as
        | { design?: { attachmentId: string | null } }
        | undefined;
      expect(sa?.design?.attachmentId ?? null).toBeNull();
    }
  });

  test("stale attachment (delete returns not found) still recreates cleanly", async () => {
    writeDesign("# design\n\nv1\n");
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    const initial = (await readState()).specAttachments as {
      design: { attachmentId: string };
    };
    const oldId = initial.design.attachmentId;
    writeDesign("# design\n\nv2\n");
    m.failNextDeleteWithNotFound = true;
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 2,
      log: log.fn,
      mutations: m,
    });
    const after = (await readState()).specAttachments as {
      design: { attachmentId: string };
    };
    expect(after.design.attachmentId).not.toBe(oldId);
    expect(m.creates.length).toBe(2);
    expect(log.entries.some((e) => e.includes("already gone — recreating"))).toBe(true);
  });

  test("deleteAttachment generic failure is non-fatal — the new attachment is still created", async () => {
    writeDesign("# design\n\nv1\n");
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    const before = (await readState()).specAttachments as {
      design: { attachmentId: string };
    };
    writeDesign("# design\n\nv2\n");
    m.failDeleteWith = new Error("boom-delete");
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 2,
      log: log.fn,
      mutations: m,
    });
    const after = (await readState()).specAttachments as {
      design: { attachmentId: string; sha256: string };
    };
    expect(after.design.attachmentId).not.toBe(before.design.attachmentId);
    expect(m.creates.length).toBe(2);
    expect(log.entries.some((e) => e.startsWith("yellow|") && e.includes("deleteAttachment"))).toBe(
      true,
    );
  });

  test("createAttachmentForUrl failure on first run logs yellow and leaves state empty", async () => {
    writeDesign();
    const m = makeMutations();
    m.failCreateWith = new Error("boom-create");
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.uploads).toHaveLength(1);
    expect(
      log.entries.some((e) => e.startsWith("yellow|") && e.includes("createAttachmentForUrl")),
    ).toBe(true);
    if (await Bun.file(statePath).exists()) {
      const sa = (await readState()).specAttachments as
        | { design?: { attachmentId: string | null } }
        | undefined;
      expect(sa?.design?.attachmentId ?? null).toBeNull();
    }
  });

  test("formats: ['md','pdf'] uploads design.md and design.pdf peer slots", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
      formats: ["md", "pdf"],
    });
    expect(m.uploads.map((u) => u.filename)).toEqual(["design.md", "design.pdf"]);
    const pdfUploads = m.uploads.filter((u) => u.filename.endsWith(".pdf"));
    expect(pdfUploads).toHaveLength(1);
    expect(new TextDecoder().decode(pdfUploads[0]!.bytes.slice(0, 4))).toBe("%PDF");
    const state = await readState();
    const sa = state.specAttachments as {
      design: { attachmentId: string; sha256: string };
      designPdf: { attachmentId: string; sha256: string };
    };
    expect(sa.designPdf.attachmentId).toMatch(/^att-/);
    expect(sa.designPdf.sha256).toBe(sa.design.sha256);
  });

  test("formats: ['md','pdf'] hash-skips PDF when design.md + tasks.md are unchanged", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
      formats: ["md", "pdf"] as ("md" | "pdf")[],
    };
    await syncSpecAttachments({ ...deps });
    const baseline = m.uploads.length;
    await syncSpecAttachments({ ...deps, iteration: 2 });
    expect(m.uploads.length).toBe(baseline);
  });

  test("empty state + pre-seeded Linear design attachment is adopted without creating a duplicate", async () => {
    writeDesign();
    const m = makeMutations();
    m.attachmentsByTitle.set("Ralph design", "att-existing-1");
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.deletes.map((d) => d.attachmentId)).toEqual(["att-existing-1"]);
    expect(m.creates).toHaveLength(1);
    expect(log.entries.some((e) => e.includes("adopted existing design.md"))).toBe(true);
    const state = await readState();
    const sa = state.specAttachments as { design: { attachmentId: string; sha256: string } };
    expect(sa.design.attachmentId).toMatch(/^att-/);
    expect(sa.design.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("empty state + no seeded match behaves like first-run create", async () => {
    writeDesign();
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    // findIssueAttachmentByTitle is consulted twice: once by the legacy
    // purge (looking for "Ralph proposal") and once by the design adopt.
    expect(m.findCalls).toBeGreaterThanOrEqual(1);
    expect(m.deletes).toHaveLength(0);
    expect(m.creates).toHaveLength(1);
  });

  test("populated state skips the adoption query (fast path)", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    };
    await syncSpecAttachments(deps);
    const findCallsAfterFirst = m.findCalls;
    await syncSpecAttachments({ ...deps, iteration: 2 });
    expect(m.findCalls).toBe(findCallsAfterFirst);
  });

  test("idempotent two-run sequence on wiped state yields one design attachment", async () => {
    writeDesign();
    writeTasks();
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.attachmentsByTitle.size).toBe(1);
    rmSync(statePath, { force: true });
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 2,
      log: log.fn,
      mutations: m,
    });
    expect(m.attachmentsByTitle.size).toBe(1);
    expect(m.attachmentsByTitle.has("Ralph design")).toBe(true);
  });

  test("malformed .ralph-state.json is treated as empty state (first-run path)", async () => {
    writeDesign();
    mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
    writeFileSync(statePath, "{not json");
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.creates).toHaveLength(1);
    const state = await readState();
    const sa = state.specAttachments as { design: { attachmentId: string } };
    expect(sa.design.attachmentId).toMatch(/^att-/);
  });

  test("skips upload when design.md has only scaffold placeholders (RLF-147)", async () => {
    writeDesign(
      "# Design for RLF-1\n\n_Fill in the technical design as you work through the issue._\n",
    );
    const m = makeMutations();
    const log = makeLog();
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    });
    expect(m.uploads).toHaveLength(0);
    expect(m.creates).toHaveLength(0);
    expect(m.deletes).toHaveLength(0);
    expect(log.entries.some((e) => e.includes("has no content yet, skipping"))).toBe(true);
    if (await Bun.file(statePath).exists()) {
      const sa = (await readState()).specAttachments as
        | { design?: { attachmentId: string | null } }
        | undefined;
      expect(sa?.design?.attachmentId ?? null).toBeNull();
    }
  });

  test("uploads once placeholder design.md is replaced with real content (RLF-147)", async () => {
    writeDesign("# Design for RLF-1\n\n_Fill in…_\n");
    const m = makeMutations();
    const log = makeLog();
    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: log.fn,
      mutations: m,
    };
    await syncSpecAttachments(deps);
    expect(m.uploads).toHaveLength(0);

    writeDesign("# design\n\nActual prose body that explains the design.\n");
    await syncSpecAttachments({ ...deps, iteration: 2 });
    expect(m.uploads.map((u) => u.filename)).toEqual(["design.md"]);
    expect(m.creates).toHaveLength(1);
    const state = await readState();
    const sa = state.specAttachments as {
      design: { attachmentId: string; sha256: string };
    };
    expect(sa.design.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("extractImplementationSection", () => {
  const TASKS = [
    "# Tasks for TST-1",
    "",
    "## Planning",
    "",
    "- [ ] Read the Linear issue and research the codebase",
    "- [ ] Fill in design.md with the technical design",
    "",
    "## Implementation",
    "",
    "- [ ] Add the feature flag",
    "### sub-area",
    "- [ ] Wire the route",
    "",
    "## Verification",
    "",
    "- [ ] Run lint and tests",
    "",
  ].join("\n");

  test("returns only the Implementation section, dropping Planning and the title", () => {
    const out = extractImplementationSection(TASKS);
    expect(out.startsWith("## Implementation")).toBe(true);
    expect(out).toContain("Add the feature flag");
    expect(out).toContain("### sub-area");
    expect(out).toContain("Wire the route");
    expect(out).not.toContain("## Planning");
    expect(out).not.toContain("research the codebase");
    expect(out).not.toContain("# Tasks for TST-1");
  });

  test("stops at the next H2 — does not bleed into later sections", () => {
    const out = extractImplementationSection(TASKS);
    expect(out).not.toContain("## Verification");
    expect(out).not.toContain("Run lint and tests");
  });

  test("returns empty string when there is no Implementation section (mid-planning)", () => {
    const planningOnly = "# Tasks for TST-1\n\n## Planning\n\n- [ ] research\n";
    expect(extractImplementationSection(planningOnly)).toBe("");
  });

  test("matches the heading case-insensitively", () => {
    const lower = "## implementation\n\n- [ ] do it\n";
    expect(extractImplementationSection(lower)).toContain("do it");
  });
});
