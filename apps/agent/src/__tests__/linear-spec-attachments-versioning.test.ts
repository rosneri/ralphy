import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractImplementationSection,
  isDesignSealed,
  resolveTriggerLabel,
  syncSpecAttachments,
  versionedTitle,
  type SpecAttachmentMutations,
} from "../agent/linear-sync/spec-attachments";

let tempDir: string;
let changeDir: string;
let stateDir: string;
let statePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spec-attachments-versioning-"));
  changeDir = join(tempDir, "openspec", "changes", "demo");
  stateDir = join(tempDir, ".ralph", "tasks", "demo");
  statePath = join(stateDir, ".ralph-state.json");
  mkdirSync(changeDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

interface UploadCall {
  filename: string;
  bytes: Uint8Array;
}
interface CreateCall {
  title: string;
  url: string;
  subtitle?: string;
}

interface FakeMutations extends SpecAttachmentMutations {
  uploads: UploadCall[];
  creates: CreateCall[];
  deletes: { attachmentId: string }[];
  /** id keyed by exact title — both pre-seeded adoptable attachments and
   *  freshly created ones land here. */
  attachmentsByTitle: Map<string, string>;
}

function makeMutations(seed?: Map<string, string>): FakeMutations {
  let nextId = 1;
  const m: FakeMutations = {
    uploads: [],
    creates: [],
    deletes: [],
    attachmentsByTitle: seed ?? new Map(),
    uploadFileToLinear: async (_apiKey, input) => {
      m.uploads.push({ filename: input.filename, bytes: input.bytes });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${nextId++}` };
    },
    createAttachmentForUrl: async (_apiKey, input) => {
      m.creates.push({ title: input.title, url: input.url, subtitle: input.subtitle });
      const id = `att-new-${nextId++}`;
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

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

/** Same composed bytes the production code uploads for the design slot:
 *  design.md, a separator, then only the `## Implementation` section of
 *  tasks.md. */
function composedDesignBytes(designBody: string, tasksMarkdown: string): Uint8Array {
  const enc = new TextEncoder();
  const impl = extractImplementationSection(tasksMarkdown);
  const parts = [enc.encode(designBody), enc.encode(`\n\n---\n\n${impl}\n`)];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const TASKS =
  "# Tasks for demo\n\n## Planning\n\n- [ ] plan\n\n## Implementation\n\n- [ ] do thing\n";

function writeChange(designBody: string): void {
  writeFileSync(join(changeDir, "design.md"), designBody);
  writeFileSync(join(changeDir, "tasks.md"), TASKS);
}

/** Write a `.ralph-state.<slot>.json` sidecar verbatim. */
function writeSidecar(slot: string, obj: unknown): void {
  writeFileSync(join(stateDir, `.ralph-state.${slot}.json`), JSON.stringify(obj, null, 2));
}

/** Read the persisted specAttachments sidecar (the single writer of
 *  `specAttachments.*`). */
function readSpecAttachmentsSidecar(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(stateDir, ".ralph-state.specAttachments.json"), "utf8"));
}

function makeDeps(m: FakeMutations, formats: ("md" | "pdf")[] = ["md"]) {
  return {
    apiKey: "k",
    issueId: "iss",
    statePath,
    changeDir,
    iteration: 7,
    log: noopLog,
    mutations: m,
    formats,
  };
}

describe("isDesignSealed", () => {
  test("false when no pr / confirmation sidecar exists", async () => {
    expect(await isDesignSealed(stateDir)).toBe(false);
  });

  test("true when the pr sidecar has a non-empty url", async () => {
    writeSidecar("pr", { url: "https://github.com/o/r/pull/1" });
    expect(await isDesignSealed(stateDir)).toBe(true);
  });

  test("false when the pr sidecar url is empty", async () => {
    writeSidecar("pr", { url: "" });
    expect(await isDesignSealed(stateDir)).toBe(false);
  });

  test("true when the confirmation sidecar has earlyDraftPrAt", async () => {
    writeSidecar("confirmation", { earlyDraftPrAt: "2026-06-03T00:00:00Z" });
    expect(await isDesignSealed(stateDir)).toBe(true);
  });

  test("false when confirmation.earlyDraftPrAt is null", async () => {
    writeSidecar("confirmation", { earlyDraftPrAt: null });
    expect(await isDesignSealed(stateDir)).toBe(false);
  });
});

describe("resolveTriggerLabel", () => {
  test("review → review follow-up", async () => {
    writeSidecar("flow", { actorSnapshot: { value: "review" } });
    expect(await resolveTriggerLabel(stateDir)).toBe("review follow-up");
  });
  test("ci-fix → CI fix", async () => {
    writeSidecar("flow", { actorSnapshot: { value: "ci-fix" } });
    expect(await resolveTriggerLabel(stateDir)).toBe("CI fix");
  });
  test("conflict-fix → conflict fix", async () => {
    writeSidecar("flow", { actorSnapshot: { value: "conflict-fix" } });
    expect(await resolveTriggerLabel(stateDir)).toBe("conflict fix");
  });
  test("unknown state → revision", async () => {
    writeSidecar("flow", { actorSnapshot: { value: "working" } });
    expect(await resolveTriggerLabel(stateDir)).toBe("revision");
  });
  test("missing flow sidecar → revision", async () => {
    expect(await resolveTriggerLabel(stateDir)).toBe("revision");
  });
});

describe("versionedTitle", () => {
  test("md slot has no PDF suffix", () => {
    expect(versionedTitle("design", 2, "revision")).toBe("Ralph design #2 (revision)");
  });
  test("designPdf slot appends (PDF)", () => {
    expect(versionedTitle("designPdf", 3, "CI fix")).toBe("Ralph design #3 (CI fix) (PDF)");
  });
});

describe("syncSpecAttachments — versioned (sealed) path", () => {
  test("not sealed: in-place update of v1, no revision recorded", async () => {
    writeChange("# design\n\nfirst body content here.\n");
    // v1 recorded with a stale sha so the content counts as changed.
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: "stale" },
    });
    const m = makeMutations(new Map([["Ralph design", "att-v1"]]));

    await syncSpecAttachments(makeDeps(m));

    // In-place delete + create on the base title; no versioned attachment.
    expect(m.deletes).toHaveLength(1);
    expect(m.creates).toHaveLength(1);
    expect(m.creates[0]?.title).toBe("Ralph design");
    const sa = readSpecAttachmentsSidecar();
    expect(sa.designRevisions ?? []).toEqual([]);
  });

  test("sealed first change creates #2 with v1 untouched (no delete)", async () => {
    const v1Body = "# design\n\noriginal sealed body.\n";
    const v1Sha = sha256Hex(composedDesignBytes(v1Body, TASKS));
    writeChange("# design\n\nrevised after PR comment.\n");
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    writeSidecar("flow", { actorSnapshot: { value: "review" } });
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: v1Sha },
    });
    const m = makeMutations(new Map([["Ralph design", "att-v1"]]));

    await syncSpecAttachments(makeDeps(m));

    expect(m.deletes).toHaveLength(0);
    expect(m.creates).toHaveLength(1);
    expect(m.creates[0]?.title).toBe("Ralph design #2 (review follow-up)");
    // v1 attachment still present.
    expect(m.attachmentsByTitle.get("Ralph design")).toBe("att-v1");

    const sa = readSpecAttachmentsSidecar();
    const revs = sa.designRevisions as Array<Record<string, unknown>>;
    expect(revs).toHaveLength(1);
    expect(revs[0]?.version).toBe(2);
    expect(revs[0]?.trigger).toBe("review follow-up");
    expect(typeof revs[0]?.attachmentId).toBe("string");
  });

  test("sealed second change creates #3, v1 and #2 untouched", async () => {
    const v1Sha = sha256Hex(composedDesignBytes("# design\n\nv1 body.\n", TASKS));
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    writeSidecar("flow", { actorSnapshot: { value: "ci-fix" } });
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: v1Sha },
      designRevisions: [
        { version: 2, attachmentId: "att-2", sha256: "sha2", trigger: "review follow-up" },
      ],
    });
    writeChange("# design\n\nthird distinct body.\n");
    const m = makeMutations(
      new Map([
        ["Ralph design", "att-v1"],
        ["Ralph design #2 (review follow-up)", "att-2"],
      ]),
    );

    await syncSpecAttachments(makeDeps(m));

    expect(m.deletes).toHaveLength(0);
    expect(m.creates).toHaveLength(1);
    expect(m.creates[0]?.title).toBe("Ralph design #3 (CI fix)");
    expect(m.attachmentsByTitle.get("Ralph design")).toBe("att-v1");
    expect(m.attachmentsByTitle.get("Ralph design #2 (review follow-up)")).toBe("att-2");

    const revs = readSpecAttachmentsSidecar().designRevisions as Array<Record<string, unknown>>;
    expect(revs).toHaveLength(2);
    expect(revs[1]?.version).toBe(3);
    expect(revs[1]?.trigger).toBe("CI fix");
  });

  test("sealed, content unchanged vs v1 → no network calls", async () => {
    const body = "# design\n\nunchanged sealed body.\n";
    const v1Sha = sha256Hex(composedDesignBytes(body, TASKS));
    writeChange(body);
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: v1Sha },
    });
    const m = makeMutations(new Map([["Ralph design", "att-v1"]]));

    await syncSpecAttachments(makeDeps(m));

    expect(m.uploads).toHaveLength(0);
    expect(m.creates).toHaveLength(0);
    expect(m.deletes).toHaveLength(0);
  });

  test("sealed, content matches a prior revision sha → no network calls", async () => {
    const body = "# design\n\nreverted to revision content.\n";
    const revSha = sha256Hex(composedDesignBytes(body, TASKS));
    writeChange(body);
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: "v1sha" },
      designRevisions: [{ version: 2, attachmentId: "att-2", sha256: revSha, trigger: "revision" }],
    });
    const m = makeMutations(new Map([["Ralph design", "att-v1"]]));

    await syncSpecAttachments(makeDeps(m));

    expect(m.uploads).toHaveLength(0);
    expect(m.creates).toHaveLength(0);
    expect(m.deletes).toHaveLength(0);
  });

  test("PDF format produces a versioned PDF attachment in designPdfRevisions", async () => {
    const v1Sha = sha256Hex(composedDesignBytes("# design\n\nv1 body.\n", TASKS));
    writeChange("# design\n\npdf revision body.\n");
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    writeSidecar("specAttachments", {
      design: { attachmentId: "att-v1", sha256: v1Sha },
      designPdf: { attachmentId: "att-v1-pdf", sha256: v1Sha },
    });
    const m = makeMutations(
      new Map([
        ["Ralph design", "att-v1"],
        ["Ralph design (PDF)", "att-v1-pdf"],
      ]),
    );

    await syncSpecAttachments(makeDeps(m, ["md", "pdf"]));

    const titles = m.creates.map((c) => c.title).sort();
    expect(titles).toEqual(["Ralph design #2 (revision)", "Ralph design #2 (revision) (PDF)"]);

    const sa = readSpecAttachmentsSidecar();
    const mdRevs = sa.designRevisions as Array<Record<string, unknown>>;
    const pdfRevs = sa.designPdfRevisions as Array<Record<string, unknown>>;
    expect(mdRevs).toHaveLength(1);
    expect(pdfRevs).toHaveLength(1);
    expect(pdfRevs[0]?.version).toBe(2);
  });

  test("wiped state: adopt an existing versioned attachment instead of duplicating", async () => {
    writeChange("# design\n\nbody after a state wipe.\n");
    writeSidecar("pr", { url: "https://github.com/o/r/pull/9" });
    // No specAttachments sidecar (state wiped) but the #2 attachment survived.
    const m = makeMutations(new Map([["Ralph design #2 (revision)", "att-existing-2"]]));

    await syncSpecAttachments(makeDeps(m));

    expect(m.creates).toHaveLength(0);
    const revs = readSpecAttachmentsSidecar().designRevisions as Array<Record<string, unknown>>;
    expect(revs).toHaveLength(1);
    expect(revs[0]?.attachmentId).toBe("att-existing-2");
    expect(revs[0]?.version).toBe(2);
  });
});
