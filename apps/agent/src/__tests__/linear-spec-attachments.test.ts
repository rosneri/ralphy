import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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
interface UpdateCall {
  attachmentId: string;
  url: string;
  subtitle?: string;
}

interface FakeMutations extends SpecAttachmentMutations {
  uploads: UploadCall[];
  creates: CreateCall[];
  updates: UpdateCall[];
  failUploadWith?: Error;
  failNextUpdateWithNotFound: boolean;
}

function makeMutations(initialId = 1): FakeMutations {
  let nextId = initialId;
  const m: FakeMutations = {
    uploads: [],
    creates: [],
    updates: [],
    failNextUpdateWithNotFound: false,
    uploadFileToLinear: async (_apiKey, input) => {
      if (m.failUploadWith) throw m.failUploadWith;
      m.uploads.push({ filename: input.filename, bytes: input.bytes });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${nextId++}` };
    },
    createAttachmentForUrl: async (_apiKey, input) => {
      m.creates.push(input);
      return `att-${nextId++}`;
    },
    updateAttachmentUrl: async (_apiKey, attachmentId, url, subtitle) => {
      if (m.failNextUpdateWithNotFound) {
        m.failNextUpdateWithNotFound = false;
        const err = new Error("Linear API returned errors") as Error & { messages?: string[] };
        err.messages = ["Entity not found: Attachment"];
        throw err;
      }
      m.updates.push({ attachmentId, url, ...(subtitle !== undefined ? { subtitle } : {}) });
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

async function readState(): Promise<{ specAttachments?: Record<string, unknown> }> {
  return JSON.parse(await Bun.file(statePath).text()) as {
    specAttachments?: Record<string, unknown>;
  };
}

function writeProposal(text = "# proposal\n\nbody\n"): void {
  writeFileSync(join(changeDir, "proposal.md"), text);
}
function writeDesign(text = "# design\n\nbody\n"): void {
  writeFileSync(join(changeDir, "design.md"), text);
}

describe("syncSpecAttachments", () => {
  test("first run uploads both files and persists ids + hashes", async () => {
    writeProposal();
    writeDesign();
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
    expect(m.uploads.map((u) => u.filename)).toEqual(["proposal.md", "design.md"]);
    expect(m.creates).toHaveLength(2);
    expect(m.updates).toHaveLength(0);
    const state = await readState();
    const sa = state.specAttachments as {
      proposal: { attachmentId: string; sha256: string };
      design: { attachmentId: string; sha256: string };
    };
    expect(sa.proposal.attachmentId).toMatch(/^att-/);
    expect(sa.design.attachmentId).toMatch(/^att-/);
    expect(sa.proposal.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sa.design.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.creates[0]!.subtitle).toBe("iteration 4");
  });

  test("unchanged content skips uploads on second run", async () => {
    writeProposal();
    writeDesign();
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
    expect(m.updates.length).toBe(0);
  });

  test("changed content calls attachmentUpdate only for the changed slot", async () => {
    writeProposal("# proposal\n\nv1\n");
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
    writeProposal("# proposal\n\nv2 — changed\n");
    await syncSpecAttachments({
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 2,
      log: log.fn,
      mutations: m,
    });
    expect(m.updates).toHaveLength(1);
    expect(m.uploads.map((u) => u.filename)).toEqual(["proposal.md", "design.md", "proposal.md"]);
  });

  test("missing design.md only uploads the proposal slot", async () => {
    writeProposal();
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
    expect(m.uploads.map((u) => u.filename)).toEqual(["proposal.md"]);
    expect(m.creates).toHaveLength(1);
    expect(log.entries.some((e) => e.includes("design.md missing"))).toBe(true);
  });

  test("upload error logs yellow and leaves .ralph-state.json untouched", async () => {
    writeProposal();
    writeDesign();
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
    expect(await Bun.file(statePath).exists()).toBe(false);
  });

  test("stale attachment id triggers a fresh attachmentCreate and replaces persisted id", async () => {
    writeProposal("# proposal\n\nv1\n");
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
      proposal: { attachmentId: string };
    };
    const oldId = initial.proposal.attachmentId;
    writeProposal("# proposal\n\nv2\n");
    m.failNextUpdateWithNotFound = true;
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
      proposal: { attachmentId: string };
    };
    expect(after.proposal.attachmentId).not.toBe(oldId);
    expect(m.creates.length).toBe(2);
  });
});
