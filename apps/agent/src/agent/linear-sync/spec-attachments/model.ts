/**
 * Shared types and slot specifications for the spec-attachment sync. Kept in a
 * dependency-light leaf module so the state store, compose helpers, and the
 * sync engine can all share them without import cycles.
 */

import { renderMarkdownToPdf } from "../render-pdf";
import type { LogFn } from "../utils";

export type AttachmentFormat = "md" | "pdf";

export type Slot = "design" | "designPdf";
/** Legacy slot names retained only for purge-on-upgrade. Past versions
 *  uploaded proposal.md / proposal.pdf as their own attachments; we now
 *  publish only design (tasks.md embedded), so state carrying these slot
 *  ids must be cleared and the Linear attachments deleted on next sync. */
export type LegacySlot = "proposal" | "proposalPdf";

export interface SlotSpec {
  /** Source files (always .md) on disk to read, in order. The first file is
   *  required; subsequent files are appended to the upload payload, separated
   *  by a markdown rule. Missing trailing files are skipped silently. */
  sourceFiles: string[];
  /** Filename to give Linear at upload time. */
  uploadFilename: string;
  /** MIME type Linear should record. */
  contentType: string;
  /** The title (required for AttachmentUpdateInput). */
  title: string;
  /** The format flag this slot belongs to. */
  format: AttachmentFormat;
  /** Transform the composed source bytes for upload. md is identity; pdf
   *  renders via pdfkit. */
  renderBytes: (sourceBytes: Uint8Array) => Promise<Uint8Array>;
}

const identityRender = async (b: Uint8Array): Promise<Uint8Array> => b;
const pdfRender =
  (title: string) =>
  async (b: Uint8Array): Promise<Uint8Array> =>
    renderMarkdownToPdf(new TextDecoder().decode(b), title);

export const SLOT_SPECS: Record<Slot, SlotSpec> = {
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

export const LEGACY_SLOT_TITLES: Record<LegacySlot, string> = {
  proposal: "Ralph proposal",
  proposalPdf: "Ralph proposal (PDF)",
};

export interface SpecAttachmentSlot {
  attachmentId: string | null;
  sha256: string | null;
}

/** One post-sealed design revision (v2+). Mirrors `RevisionSchema` in
 *  `@ralphy/types`; redeclared locally to keep this module dependency-light. */
export interface Revision {
  version: number;
  attachmentId: string;
  sha256: string;
  trigger: string;
}

export interface SpecAttachmentsState {
  design: SpecAttachmentSlot;
  designPdf: SpecAttachmentSlot;
  /** Carried only for purge-on-upgrade — never re-uploaded. */
  proposal: SpecAttachmentSlot;
  proposalPdf: SpecAttachmentSlot;
  /** Post-sealed revisions (v2+) for each design slot. `[]` when the
   *  change has not been sealed or has had no post-sealed content change. */
  designRevisions: Revision[];
  designPdfRevisions: Revision[];
}

/** Map a design slot to the `specAttachments.*Revisions` array that tracks its
 *  post-sealed versions. */
export const REVISIONS_KEY: Record<Slot, "designRevisions" | "designPdfRevisions"> = {
  design: "designRevisions",
  designPdf: "designPdfRevisions",
};

export const EMPTY_SLOT: SpecAttachmentSlot = { attachmentId: null, sha256: null };

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

export interface SpecAttachmentsDeps {
  apiKey: string;
  issueId: string;
  /** Absolute path to `.ralph-state.json` for this change. */
  statePath: string;
  /** Absolute path to `openspec/changes/<name>` for this change. */
  changeDir: string;
  iteration: number;
  log: LogFn;
  /** File-only sink for recurring unchanged-skip lines; falls back to `log`. */
  fileLog?: LogFn;
  mutations: SpecAttachmentMutations;
  /** Formats to upload. Default ["md"]; add "pdf" for a pdfkit mirror keyed off the same source-md hash. */
  formats?: AttachmentFormat[];
  /** Post-seal behavior: "append" (default) publishes a new `#N` revision per design change; "replace" overwrites in place. */
  sealedRevisionMode?: "append" | "replace";
}
