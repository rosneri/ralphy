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
import { type LogFn, sha256Hex } from "./utils";

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

type Slot = "design" | "designPdf";
/** Legacy slot names retained only for purge-on-upgrade. Past versions
 *  uploaded proposal.md / proposal.pdf as their own attachments; we now
 *  publish only design (with tasks.md content embedded), so any state
 *  carrying these slot ids must be cleared and the Linear attachments
 *  deleted on next sync. */
type LegacySlot = "proposal" | "proposalPdf";

interface SlotSpec {
  /** Source files (always .md) on disk to read, in order. The first file
   *  is required; subsequent files are appended to form the upload
   *  payload, separated by a markdown rule. Missing trailing files are
   *  skipped silently. */
  sourceFiles: string[];
  /** Filename to give Linear at upload time. */
  uploadFilename: string;
  /** MIME type Linear should record. */
  contentType: string;
  /** Attachment title (required by AttachmentUpdateInput). */
  title: string;
  /** Which format flag this slot belongs to. */
  format: AttachmentFormat;
  /** Transform the composed source bytes into the bytes to upload. md is
   *  identity; pdf renders via pdfkit. */
  renderBytes: (sourceBytes: Uint8Array) => Promise<Uint8Array>;
}

const identityRender = async (b: Uint8Array): Promise<Uint8Array> => b;
const pdfRender =
  (title: string) =>
  async (b: Uint8Array): Promise<Uint8Array> =>
    renderMarkdownToPdf(new TextDecoder().decode(b), title);

const SLOT_SPECS: Record<Slot, SlotSpec> = {
  design: {
    sourceFiles: ["design.md", "tasks.md"],
    uploadFilename: "design.md",
    contentType: "text/markdown",
    title: "Ralph design",
    format: "md",
    renderBytes: identityRender,
  },
  designPdf: {
    sourceFiles: ["design.md", "tasks.md"],
    uploadFilename: "design.pdf",
    contentType: "application/pdf",
    title: "Ralph design (PDF)",
    format: "pdf",
    renderBytes: pdfRender("Ralph design"),
  },
};

const LEGACY_SLOT_TITLES: Record<LegacySlot, string> = {
  proposal: "Ralph proposal",
  proposalPdf: "Ralph proposal (PDF)",
};

interface SpecAttachmentSlot {
  attachmentId: string | null;
  sha256: string | null;
}

interface SpecAttachmentsState {
  design: SpecAttachmentSlot;
  designPdf: SpecAttachmentSlot;
  /** Carried only for purge-on-upgrade — never re-uploaded. */
  proposal: SpecAttachmentSlot;
  proposalPdf: SpecAttachmentSlot;
}

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
    const parsed: unknown = await file.json();
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

/** True iff `bytes` (UTF-8 markdown) contain at least one line that
 *  isn't scaffold noise. Scaffold noise = blank lines, markdown headings,
 *  italic-only placeholder lines (`_..._`), and the `Source:` /
 *  `Status:` / `Assignee:` / `Labels:` metadata block emitted by
 *  `scaffoldChangeForIssue`. Used to keep first-iteration template
 *  stubs out of Linear. */
function hasMeaningfulContent(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes);
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (/^_.+_$/.test(line)) continue;
    if (/^(Source|Status|Assignee|Labels):/.test(line)) continue;
    return true;
  }
  return false;
}

async function syncSlot(deps: SpecAttachmentsDeps, slot: Slot): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const [primaryName, ...trailingNames] = spec.sourceFiles;
  if (!primaryName) return;
  const primary = Bun.file(join(deps.changeDir, primaryName));
  if (!(await primary.exists())) {
    deps.log(`  spec-attachments: ${primaryName} missing, skipping`, "gray");
    return;
  }

  let primaryBytes: Uint8Array;
  try {
    primaryBytes = await primary.bytes();
  } catch (err) {
    deps.log(`! spec-attachments: read ${primaryName} failed: ${(err as Error).message}`, "yellow");
    return;
  }

  if (!hasMeaningfulContent(primaryBytes)) {
    deps.log(`  spec-attachments: ${primaryName} has no content yet, skipping`, "gray");
    return;
  }

  // Compose the upload payload by appending any present trailing source
  // files (e.g. tasks.md after design.md), separated by a markdown rule
  // so reviewers can tell the sections apart inside one attachment.
  const parts: Uint8Array[] = [primaryBytes];
  const enc = new TextEncoder();
  for (const name of trailingNames) {
    const f = Bun.file(join(deps.changeDir, name));
    if (!(await f.exists())) continue;
    try {
      const bytes = await f.bytes();
      if (bytes.length === 0) continue;
      parts.push(enc.encode(`\n\n---\n\n# ${name}\n\n`));
      parts.push(bytes);
    } catch (err) {
      deps.log(
        `! spec-attachments: read ${name} failed (continuing without it): ${(err as Error).message}`,
        "yellow",
      );
    }
  }
  const totalLen = parts.reduce((n, p) => n + p.length, 0);
  const sourceBytes = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    sourceBytes.set(p, offset);
    offset += p.length;
  }

  // Hash the *composed* source so the md and pdf slots track the same
  // content signal. A change to either design.md or tasks.md invalidates
  // both the design and designPdf slots.
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

/** Delete any pre-existing proposal / proposalPdf attachments left over
 *  from before we consolidated everything into the design slot. Runs once
 *  per change: persists `legacyProposalPurged: true` in state so the
 *  Linear lookup is not repeated every sync. */
async function purgeLegacyProposalSlots(deps: SpecAttachmentsDeps): Promise<void> {
  const raw = await readRawState(deps.statePath);
  const sa = (raw.specAttachments as Record<string, unknown> | undefined) ?? {};
  if (sa.legacyProposalPurged === true) return;
  const state = await readSpecAttachments(deps.statePath);
  for (const slot of ["proposal", "proposalPdf"] as LegacySlot[]) {
    const recordedId = state[slot]?.attachmentId ?? null;
    let idToDelete = recordedId;
    if (!idToDelete) {
      try {
        idToDelete = await deps.mutations.findIssueAttachmentByTitle(
          deps.apiKey,
          deps.issueId,
          LEGACY_SLOT_TITLES[slot],
        );
      } catch (err) {
        deps.log(
          `! spec-attachments: legacy lookup for ${LEGACY_SLOT_TITLES[slot]} failed (skipping): ${describeLinearError(err)}`,
          "yellow",
        );
        idToDelete = null;
      }
    }
    if (!idToDelete) continue;
    try {
      await deps.mutations.deleteAttachment(deps.apiKey, idToDelete);
      deps.log(
        `  spec-attachments: removed legacy ${LEGACY_SLOT_TITLES[slot]} attachment ${idToDelete}`,
        "gray",
      );
    } catch (err) {
      if (isCommentNotFoundError(err)) {
        deps.log(
          `  spec-attachments: legacy ${LEGACY_SLOT_TITLES[slot]} attachment already gone`,
          "gray",
        );
      } else {
        deps.log(
          `! spec-attachments: delete legacy ${LEGACY_SLOT_TITLES[slot]} failed (continuing): ${describeLinearError(err)}`,
          "yellow",
        );
      }
    }
    if (recordedId) {
      await persistSlot(deps.statePath, slot, EMPTY_SLOT);
    }
  }
  await writeField(
    stateDirOf(deps.statePath),
    "linear-attachments",
    "specAttachments.legacyProposalPurged",
    true,
  );
}

/** Sync the design attachment (design.md with tasks.md appended) and,
 *  optionally, its pdfkit-rendered PDF mirror, to Linear. Any pre-existing
 *  proposal attachments from before this slot consolidation are deleted
 *  on first run. Slots are independent — a missing or failing slot does
 *  not affect the others. */
export async function syncSpecAttachments(deps: SpecAttachmentsDeps): Promise<void> {
  await purgeLegacyProposalSlots(deps);
  const enabled = new Set<AttachmentFormat>(deps.formats ?? ["md"]);
  const order: Slot[] = ["design", "designPdf"];
  for (const slot of order) {
    if (!enabled.has(SLOT_SPECS[slot].format)) continue;
    await syncSlot(deps, slot);
  }
}
