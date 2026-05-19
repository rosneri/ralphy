/**
 * Mirror `openspec/changes/<change>/proposal.md` and `design.md` into
 * Linear **attachments** on the parent issue. Attachment ids + content
 * hashes live in `.ralph-state.json` under `specAttachments` so the same
 * attachments are updated in place across iterations.
 *
 * On a hash match the slot is a no-op. On a hash miss the file is
 * re-uploaded and `attachmentUpdate(url:)` swings the existing
 * attachment to the new asset URL. If Linear reports the persisted
 * attachment id as missing (manual deletion) the slot is recreated.
 */

import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { isCommentNotFoundError } from "./comment-sync";

const ATTACHMENT_TITLES = {
  proposal: "Ralph proposal",
  design: "Ralph design",
} as const;

type Slot = keyof typeof ATTACHMENT_TITLES;

const SLOT_FILES: Record<Slot, string> = {
  proposal: "proposal.md",
  design: "design.md",
};

interface SpecAttachmentSlot {
  attachmentId: string | null;
  sha256: string | null;
}

interface SpecAttachmentsState {
  proposal: SpecAttachmentSlot;
  design: SpecAttachmentSlot;
}

interface PersistedState {
  specAttachments?: Partial<SpecAttachmentsState> | null;
  [key: string]: unknown;
}

type LogFn = (text: string, color?: string) => void;

export interface SpecAttachmentMutations {
  uploadFileToLinear: (
    apiKey: string,
    input: { filename: string; contentType: string; bytes: Uint8Array },
  ) => Promise<{ assetUrl: string }>;
  createAttachmentForUrl: (
    apiKey: string,
    input: { issueId: string; url: string; title: string; subtitle?: string },
  ) => Promise<string>;
  updateAttachmentUrl: (
    apiKey: string,
    attachmentId: string,
    url: string,
    subtitle?: string,
  ) => Promise<void>;
}

export interface SpecAttachmentsDeps {
  apiKey: string;
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
  mutations: SpecAttachmentMutations;
}

const EMPTY_SLOT: SpecAttachmentSlot = { attachmentId: null, sha256: null };

async function readStateJson(statePath: string): Promise<PersistedState | null> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as PersistedState;
  } catch {
    return null;
  }
}

async function writeStateJson(statePath: string, state: PersistedState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await Bun.write(statePath, JSON.stringify(state, null, 2) + "\n");
}

function readSpecState(state: PersistedState | null): SpecAttachmentsState {
  const raw = state?.specAttachments ?? {};
  return {
    proposal: {
      attachmentId: raw?.proposal?.attachmentId ?? null,
      sha256: raw?.proposal?.sha256 ?? null,
    },
    design: {
      attachmentId: raw?.design?.attachmentId ?? null,
      sha256: raw?.design?.sha256 ?? null,
    },
  };
}

async function patchSpecState(
  statePath: string,
  patch: { slot: Slot; value: SpecAttachmentSlot },
): Promise<void> {
  const existing = (await readStateJson(statePath)) ?? {};
  const current = readSpecState(existing);
  const next: SpecAttachmentsState = { ...current, [patch.slot]: patch.value };
  await writeStateJson(statePath, { ...existing, specAttachments: next });
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function syncSlot(deps: SpecAttachmentsDeps, slot: Slot): Promise<void> {
  const filename = SLOT_FILES[slot];
  const path = join(deps.changeDir, filename);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    deps.log(`  spec-attachments: ${filename} missing, skipping`, "gray");
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch (err) {
    deps.log(`! spec-attachments: read ${filename} failed: ${(err as Error).message}`, "yellow");
    return;
  }

  const hash = sha256Hex(bytes);
  const state = await readStateJson(deps.statePath);
  const current = readSpecState(state)[slot] ?? EMPTY_SLOT;

  if (current.attachmentId && current.sha256 === hash) {
    deps.log(`  spec-attachments: ${filename} unchanged, skipping`, "gray");
    return;
  }

  const subtitle = `iteration ${deps.iteration}`;

  let assetUrl: string;
  try {
    const uploaded = await deps.mutations.uploadFileToLinear(deps.apiKey, {
      filename,
      contentType: "text/markdown",
      bytes,
    });
    assetUrl = uploaded.assetUrl;
  } catch (err) {
    deps.log(`! spec-attachments: upload ${filename} failed: ${(err as Error).message}`, "yellow");
    return;
  }

  if (current.attachmentId) {
    try {
      await deps.mutations.updateAttachmentUrl(
        deps.apiKey,
        current.attachmentId,
        assetUrl,
        subtitle,
      );
      await patchSpecState(deps.statePath, {
        slot,
        value: { attachmentId: current.attachmentId, sha256: hash },
      });
      deps.log(`  spec-attachments: refreshed ${filename}`, "gray");
      return;
    } catch (err) {
      if (!isCommentNotFoundError(err)) {
        deps.log(
          `! spec-attachments: updateAttachmentUrl ${filename} failed: ${(err as Error).message}`,
          "yellow",
        );
        return;
      }
      deps.log(
        `  spec-attachments: attachment ${current.attachmentId} not found — recreating`,
        "gray",
      );
      // Fall through to create-fresh.
    }
  }

  let newId: string;
  try {
    newId = await deps.mutations.createAttachmentForUrl(deps.apiKey, {
      issueId: deps.issueId,
      url: assetUrl,
      title: ATTACHMENT_TITLES[slot],
      subtitle,
    });
  } catch (err) {
    deps.log(
      `! spec-attachments: createAttachmentForUrl ${filename} failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }
  await patchSpecState(deps.statePath, {
    slot,
    value: { attachmentId: newId, sha256: hash },
  });
  deps.log(`  spec-attachments: created ${filename} attachment`, "gray");
}

/** Sync proposal.md and design.md as Linear attachments. Slots are
 *  independent — a missing or failing slot does not affect the other. */
export async function syncSpecAttachments(deps: SpecAttachmentsDeps): Promise<void> {
  await syncSlot(deps, "proposal");
  await syncSlot(deps, "design");
}
