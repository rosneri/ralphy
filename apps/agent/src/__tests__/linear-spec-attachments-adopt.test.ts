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
  tempDir = mkdtempSync(join(tmpdir(), "spec-attachments-adopt-"));
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

interface ContentHostedMutations extends SpecAttachmentMutations {
  uploads: UploadCall[];
  createCount: number;
  deleteCount: number;
  /** Pre-seeded attachments keyed by exact title. Their content sha256
   *  matches the source files so the hash skip path applies once adopted. */
  attachmentsByTitle: Map<string, { id: string; sha256: string }>;
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

function makeMutations(seed: Map<string, { id: string; sha256: string }>): ContentHostedMutations {
  let nextId = 1;
  const m: ContentHostedMutations = {
    uploads: [],
    createCount: 0,
    deleteCount: 0,
    attachmentsByTitle: seed,
    uploadFileToLinear: async (_apiKey, input) => {
      m.uploads.push({ filename: input.filename, bytes: input.bytes });
      return { assetUrl: `https://uploads.linear.app/${input.filename}-${nextId++}` };
    },
    createAttachmentForUrl: async (_apiKey, input) => {
      m.createCount += 1;
      const id = `att-new-${nextId++}`;
      seed.set(input.title, { id, sha256: "" });
      return id;
    },
    deleteAttachment: async (_apiKey, attachmentId) => {
      m.deleteCount += 1;
      for (const [title, v] of seed) {
        if (v.id === attachmentId) seed.delete(title);
      }
    },
    findIssueAttachmentByTitle: async (_apiKey, _issueId, title) => {
      return seed.get(title)?.id ?? null;
    },
  };
  return m;
}

/** Build the same composed bytes the production code uploads for the
 *  design slot: design.md followed by a separator and tasks.md. Used to
 *  pre-seed the on-disk hash so the adopt + hash-skip path matches. */
function composedDesignBytes(designBody: string, tasksBody: string): Uint8Array {
  const enc = new TextEncoder();
  const parts = [
    enc.encode(designBody),
    enc.encode(`\n\n---\n\ntasks.md\n\n`.replace("tasks.md", "# tasks.md")),
    enc.encode(tasksBody),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

describe("syncSpecAttachments — adopt() invariant (RLF-92)", () => {
  test("design and designPdf attachments adopted from Linear with matching content do not duplicate across polls", async () => {
    const designBody = "# design\n\nbody\n";
    const tasksBody = "- [ ] do thing\n";
    writeFileSync(join(changeDir, "design.md"), designBody);
    writeFileSync(join(changeDir, "tasks.md"), tasksBody);

    const composedSha = sha256Hex(composedDesignBytes(designBody, tasksBody));
    const seed = new Map<string, { id: string; sha256: string }>([
      ["Ralph design", { id: "att-d", sha256: composedSha }],
      ["Ralph design (PDF)", { id: "att-d-pdf", sha256: composedSha }],
    ]);
    const m = makeMutations(seed);

    mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        specAttachments: {
          design: { attachmentId: "att-d", sha256: composedSha },
          designPdf: { attachmentId: "att-d-pdf", sha256: composedSha },
        },
      }),
    );

    const deps = {
      apiKey: "k",
      issueId: "iss",
      statePath,
      changeDir,
      iteration: 1,
      log: () => {},
      mutations: m,
      formats: ["md", "pdf"] as ("md" | "pdf")[],
    };
    await syncSpecAttachments(deps);
    await syncSpecAttachments({ ...deps, iteration: 2 });
    expect(m.createCount).toBe(0);
    expect(m.deleteCount).toBe(0);
    expect(m.uploads).toHaveLength(0);
  });
});
