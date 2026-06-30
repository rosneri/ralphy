/**
 * Read and persist the `specAttachments` slot subtree. The authoritative copy
 * lives in the `.ralph-state.specAttachments.json` sidecar (single-writer);
 * inline `.ralph-state.json` slots are read only as a fallback for state
 * written before the sidecar split.
 */

import { dirname } from "node:path";
import { writeField, readSlotSidecar } from "@ralphy/core/state";
import {
  REVISIONS_KEY,
  type LegacySlot,
  type Revision,
  type Slot,
  type SpecAttachmentSlot,
  type SpecAttachmentsState,
} from "./model";

export function stateDirOf(statePath: string): string {
  return dirname(statePath);
}

async function readInlineSpecAttachments(statePath: string): Promise<Record<string, unknown>> {
  const file = Bun.file(statePath);
  if (!(await file.exists())) return {};
  try {
    const parsed: unknown = await file.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const sa = (parsed as Record<string, unknown>).specAttachments;
      return sa && typeof sa === "object" && !Array.isArray(sa)
        ? (sa as Record<string, unknown>)
        : {};
    }
    return {};
  } catch {
    return {};
  }
}

/** Read the `specAttachments` slot subtree. The authoritative copy is the
 *  `.ralph-state.specAttachments.json` sidecar (single-writer); falls back to
 *  inline core-file slots changes written before the sidecar split. */
export async function readSpecAttachmentsSubtree(
  statePath: string,
): Promise<Record<string, unknown>> {
  const sidecar = await readSlotSidecar(dirname(statePath), "specAttachments");
  return sidecar ?? (await readInlineSpecAttachments(statePath));
}

/** Coerce an unknown sidecar value into a Revision[]; drops malformed
 *  entries so a corrupt slot degrades to "no revisions" rather than throwing. */
function asRevisions(value: unknown): Revision[] {
  if (!Array.isArray(value)) return [];
  const out: Revision[] = [];
  for (const entry of value) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      if (
        typeof e.version === "number" &&
        typeof e.attachmentId === "string" &&
        typeof e.sha256 === "string" &&
        typeof e.trigger === "string"
      ) {
        out.push({
          version: e.version,
          attachmentId: e.attachmentId,
          sha256: e.sha256,
          trigger: e.trigger,
        });
      }
    }
  }
  return out;
}

export async function readSpecAttachments(statePath: string): Promise<SpecAttachmentsState> {
  const sa = (await readSpecAttachmentsSubtree(statePath)) as Partial<
    Record<Slot | LegacySlot, Partial<SpecAttachmentSlot>>
  > & { designRevisions?: unknown; designPdfRevisions?: unknown };
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
    designRevisions: asRevisions(sa.designRevisions),
    designPdfRevisions: asRevisions(sa.designPdfRevisions),
  };
}

export async function persistSlot(
  statePath: string,
  slot: Slot | LegacySlot,
  value: SpecAttachmentSlot,
): Promise<void> {
  await writeField(stateDirOf(statePath), "linear-attachments", `specAttachments.${slot}`, value);
}

export async function persistRevision(
  statePath: string,
  slot: Slot,
  revisions: Revision[],
): Promise<void> {
  await writeField(
    stateDirOf(statePath),
    "linear-attachments",
    `specAttachments.${REVISIONS_KEY[slot]}`,
    revisions,
  );
}
