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
  /** Asset URLs are tied back to their sha256 so adoption can persist the
   *  correct content hash via a Linear attachment metadata fetch. */
  hashByAttachmentId: Map<string, string>;
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

function makeMutations(seed: Map<string, { id: string; sha256: string }>): ContentHostedMutations {
  let nextId = 1;
  const hashByAttachmentId = new Map<string, string>();
  for (const [, v] of seed) hashByAttachmentId.set(v.id, v.sha256);
  const m: ContentHostedMutations = {
    uploads: [],
    createCount: 0,
    deleteCount: 0,
    attachmentsByTitle: seed,
    hashByAttachmentId,
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

describe("syncSpecAttachments — adopt() invariant (RLF-92)", () => {
  test("starting empty with all four attachments pre-seeded matching content does not create duplicates across two polls", async () => {
    const proposalBody = "# proposal\n\nbody\n";
    const designBody = "# design\n\nbody\n";
    writeFileSync(join(changeDir, "proposal.md"), proposalBody);
    writeFileSync(join(changeDir, "design.md"), designBody);

    // Pre-seed the issue with all four expected attachments, each carrying
    // the sha256 that matches the on-disk source. Once adopted we want the
    // hash-match path to fire so no upload/create/delete happens.
    const proposalSha = sha256Hex(new TextEncoder().encode(proposalBody));
    const designSha = sha256Hex(new TextEncoder().encode(designBody));
    const seed = new Map<string, { id: string; sha256: string }>([
      ["Ralph proposal", { id: "att-p", sha256: proposalSha }],
      ["Ralph design", { id: "att-d", sha256: designSha }],
      ["Ralph proposal (PDF)", { id: "att-p-pdf", sha256: proposalSha }],
      ["Ralph design (PDF)", { id: "att-d-pdf", sha256: designSha }],
    ]);
    const m = makeMutations(seed);

    // Pre-populate the .ralph-state.json with the matching hashes — this
    // models the new adopt() invariant where, once the agent has the
    // attachment id + sha256 in state, the hash-match skip applies.
    mkdirSync(join(tempDir, ".ralph", "tasks", "demo"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        specAttachments: {
          proposal: { attachmentId: "att-p", sha256: proposalSha },
          design: { attachmentId: "att-d", sha256: designSha },
          proposalPdf: { attachmentId: "att-p-pdf", sha256: proposalSha },
          designPdf: { attachmentId: "att-d-pdf", sha256: designSha },
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
