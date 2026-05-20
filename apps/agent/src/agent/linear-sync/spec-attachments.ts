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
 *
 * Each source file may produce up to two slots — the raw .md and, when
 * `specAttachmentFormats` includes "pdf", a pdfkit-rendered PDF mirror.
 * Both share the same source-file sha so the PDF skip-decision tracks
 * the markdown content directly.
 */

import { dirname, join } from "node:path";
import { writeField } from "@ralphy/core/state";
import { isCommentNotFoundError } from "./comment-sync";
import { renderMarkdownToPdf } from "./render-pdf";

/** Build a Linear-API error suffix that surfaces .status / .body / .messages
 *  fields attached by linearRequest. Without this, every HTTP failure
 *  collapses to the generic message "Linear API request failed", which
 *  hides 4xx vs 5xx and makes recurring failures undiagnosable. */
function describeLinearError(err: unknown): string {
  const e = err as Error & { status?: number; body?: string; messages?: string[] };
  const parts: string[] = [e.message ?? String(err)];
  if (typeof e.status === "number") parts.push(`status=${e.status}`);
  if (Array.isArray(e.messages) && e.messages.length > 0)
    parts.push(`messages=${e.messages.join("; ")}`);
  if (typeof e.body === "string" && e.body.length > 0) {
    const trimmed = e.body.length > 200 ? `${e.body.slice(0, 200)}…` : e.body;
    parts.push(`body=${trimmed.replace(/\s+/g, " ").trim()}`);
  }
  return parts.join(" ");
}

type AttachmentFormat = "md" | "pdf";

type Slot = "proposal" | "design" | "proposalPdf" | "designPdf";

interface SlotSpec {
  /** Source file (always a .md) on disk to read. */
  sourceFile: string;
  /** Filename to give Linear at upload time. */
  uploadFilename: string;
  /** MIME type Linear should record. */
  contentType: string;
  /** Attachment title (required by AttachmentUpdateInput). */
  title: string;
  /** Which format flag this slot belongs to. */
  format: AttachmentFormat;
  /** Transform the source bytes into the bytes to upload. md is
   *  identity; pdf renders via pdfkit. */
  renderBytes: (sourceBytes: Uint8Array) => Promise<Uint8Array>;
}

const identityRender = async (b: Uint8Array): Promise<Uint8Array> => b;
const pdfRender =
  (title: string) =>
  async (b: Uint8Array): Promise<Uint8Array> =>
    renderMarkdownToPdf(new TextDecoder().decode(b), title);

const SLOT_SPECS: Record<Slot, SlotSpec> = {
  proposal: {
    sourceFile: "proposal.md",
    uploadFilename: "proposal.md",
    contentType: "text/markdown",
    title: "Ralph proposal",
    format: "md",
    renderBytes: identityRender,
  },
  design: {
    sourceFile: "design.md",
    uploadFilename: "design.md",
    contentType: "text/markdown",
    title: "Ralph design",
    format: "md",
    renderBytes: identityRender,
  },
  proposalPdf: {
    sourceFile: "proposal.md",
    uploadFilename: "proposal.pdf",
    contentType: "application/pdf",
    title: "Ralph proposal (PDF)",
    format: "pdf",
    renderBytes: pdfRender("Ralph proposal"),
  },
  designPdf: {
    sourceFile: "design.md",
    uploadFilename: "design.pdf",
    contentType: "application/pdf",
    title: "Ralph design (PDF)",
    format: "pdf",
    renderBytes: pdfRender("Ralph design"),
  },
};

interface SpecAttachmentSlot {
  attachmentId: string | null;
  sha256: string | null;
}

interface SpecAttachmentsState {
  proposal: SpecAttachmentSlot;
  design: SpecAttachmentSlot;
  proposalPdf: SpecAttachmentSlot;
  designPdf: SpecAttachmentSlot;
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
  /** Linear's AttachmentUpdateInput has no `url` field — the only way to
   *  swing a Ralph attachment to new content is delete + create. */
  deleteAttachment: (apiKey: string, attachmentId: string) => Promise<void>;
  /** Look up an existing attachment on the issue by exact title match.
   *  Used to adopt a pre-existing Linear attachment when local state has
   *  been wiped — without this, the empty-cache path would create a
   *  duplicate every time the agent re-enters a change. */
  findIssueAttachmentByTitle: (
    apiKey: string,
    issueId: string,
    title: string,
  ) => Promise<string | null>;
}

interface SpecAttachmentsDeps {
  apiKey: string;
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
  mutations: SpecAttachmentMutations;
  /** Formats to upload. Defaults to ["md"] to preserve the legacy
   *  behaviour. Add "pdf" to also upload a pdfkit-rendered mirror as
   *  a peer slot keyed off the same source-md hash. */
  formats?: AttachmentFormat[];
}

const EMPTY_SLOT: SpecAttachmentSlot = { attachmentId: null, sha256: null };

function stateDirOf(statePath: string): string {
  return dirname(statePath);
}

async function readRawState(statePath: string): Promise<Record<string, unknown>> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return {};
  try {
    const parsed = (await file.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

async function readSpecAttachments(statePath: string): Promise<SpecAttachmentsState> {
  const raw = await readRawState(statePath);
  const sa =
    (raw.specAttachments as Partial<Record<Slot, Partial<SpecAttachmentSlot>>> | undefined) ?? {};
  return {
    proposal: {
      attachmentId: sa.proposal?.attachmentId ?? null,
      sha256: sa.proposal?.sha256 ?? null,
    },
    design: {
      attachmentId: sa.design?.attachmentId ?? null,
      sha256: sa.design?.sha256 ?? null,
    },
    proposalPdf: {
      attachmentId: sa.proposalPdf?.attachmentId ?? null,
      sha256: sa.proposalPdf?.sha256 ?? null,
    },
    designPdf: {
      attachmentId: sa.designPdf?.attachmentId ?? null,
      sha256: sa.designPdf?.sha256 ?? null,
    },
  };
}

async function persistSlot(
  statePath: string,
  slot: Slot,
  value: SpecAttachmentSlot,
): Promise<void> {
  await writeField(stateDirOf(statePath), "linear-attachments", `specAttachments.${slot}`, value);
}

/**
 * Adopt a pre-existing Linear attachment matching `slot`'s title. Used
 * when local state is empty (fresh worktree or wiped `.ralph-state.json`)
 * to prevent creating a duplicate. Failures are logged yellow and the
 * caller proceeds as if no match exists.
 */
async function adopt(deps: SpecAttachmentsDeps, slot: Slot): Promise<{ adoptedId: string | null }> {
  const spec = SLOT_SPECS[slot];
  try {
    const adoptedId = await deps.mutations.findIssueAttachmentByTitle(
      deps.apiKey,
      deps.issueId,
      spec.title,
    );
    if (adoptedId) {
      await persistSlot(deps.statePath, slot, { attachmentId: adoptedId, sha256: null });
      deps.log(
        `  spec-attachments: adopted existing ${spec.uploadFilename} attachment ${adoptedId}`,
        "gray",
      );
      return { adoptedId };
    }
    return { adoptedId: null };
  } catch (err) {
    deps.log(
      `! spec-attachments: findIssueAttachmentByTitle ${spec.uploadFilename} failed (treating as no match): ${describeLinearError(err)}`,
      "yellow",
    );
    return { adoptedId: null };
  }
}

function sha256Hex(bytes: Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

async function syncSlot(deps: SpecAttachmentsDeps, slot: Slot): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const sourcePath = join(deps.changeDir, spec.sourceFile);
  const file = Bun.file(sourcePath);
  if (!(await file.exists())) {
    deps.log(`  spec-attachments: ${spec.sourceFile} missing, skipping`, "gray");
    return;
  }

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await file.bytes();
  } catch (err) {
    deps.log(
      `! spec-attachments: read ${spec.sourceFile} failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

  // Hash the *source* so the md and pdf slots track the same content
  // signal. A change to proposal.md invalidates both proposal/proposalPdf.
  const hash = sha256Hex(sourceBytes);
  let current = (await readSpecAttachments(deps.statePath))[slot] ?? EMPTY_SLOT;

  // Empty cache: ask Linear whether an attachment with this slot's title
  // already exists on the issue. Adopting it prevents a duplicate when
  // .ralph-state.json is wiped or the worktree is re-scaffolded.
  if (!current.attachmentId) {
    const { adoptedId } = await adopt(deps, slot);
    if (adoptedId) {
      current = { attachmentId: adoptedId, sha256: null };
    }
  }

  if (current.attachmentId && current.sha256 === hash) {
    deps.log(`  spec-attachments: ${spec.uploadFilename} unchanged, skipping`, "gray");
    return;
  }

  let uploadBytes: Uint8Array;
  try {
    uploadBytes = await spec.renderBytes(sourceBytes);
  } catch (err) {
    deps.log(
      `! spec-attachments: render ${spec.uploadFilename} failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

  const subtitle = `iteration ${deps.iteration}`;

  let assetUrl: string;
  try {
    const uploaded = await deps.mutations.uploadFileToLinear(deps.apiKey, {
      filename: spec.uploadFilename,
      contentType: spec.contentType,
      bytes: uploadBytes,
    });
    assetUrl = uploaded.assetUrl;
  } catch (err) {
    deps.log(
      `! spec-attachments: upload ${spec.uploadFilename} failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }

  if (current.attachmentId) {
    // Linear's attachmentUpdate has no `url` field, so refresh = delete +
    // create. A failed delete is non-fatal (most often the attachment was
    // already removed manually) — we still create the replacement.
    try {
      await deps.mutations.deleteAttachment(deps.apiKey, current.attachmentId);
      deps.log(
        `  spec-attachments: deleted stale ${spec.uploadFilename} attachment ${current.attachmentId}`,
        "gray",
      );
    } catch (err) {
      if (isCommentNotFoundError(err)) {
        deps.log(
          `  spec-attachments: attachment ${current.attachmentId} already gone — recreating`,
          "gray",
        );
      } else {
        deps.log(
          `! spec-attachments: deleteAttachment ${spec.uploadFilename} failed (continuing): ${describeLinearError(err)}`,
          "yellow",
        );
      }
    }
  }

  let newId: string;
  try {
    newId = await deps.mutations.createAttachmentForUrl(deps.apiKey, {
      issueId: deps.issueId,
      url: assetUrl,
      title: spec.title,
      subtitle,
    });
  } catch (err) {
    deps.log(
      `! spec-attachments: createAttachmentForUrl ${spec.uploadFilename} failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }
  await persistSlot(deps.statePath, slot, { attachmentId: newId, sha256: hash });
  deps.log(`  spec-attachments: created ${spec.uploadFilename} attachment`, "gray");
}

/** Sync proposal.md / design.md (and, optionally, their pdfkit-rendered
 *  PDF mirrors) as Linear attachments. Slots are independent — a missing
 *  or failing slot does not affect the others. */
export async function syncSpecAttachments(deps: SpecAttachmentsDeps): Promise<void> {
  const enabled = new Set<AttachmentFormat>(deps.formats ?? ["md"]);
  const order: Slot[] = ["proposal", "design", "proposalPdf", "designPdf"];
  for (const slot of order) {
    if (!enabled.has(SLOT_SPECS[slot].format)) continue;
    await syncSlot(deps, slot);
  }
}
