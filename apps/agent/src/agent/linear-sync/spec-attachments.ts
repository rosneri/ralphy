/**
 * Mirror `openspec/changes/<change>/proposal.md` and `design.md` into
 * Linear **attachments** on the parent issue. Attachment ids + content
 * hashes live in `.ralph-state.json` under `specAttachments` so the same
 * attachments are updated in place across iterations.
 *
 * On a hash match a slot is a no-op. On a hash miss the file is
 * re-uploaded and `attachmentUpdate(url:)` swings the existing
 * attachment to the new asset URL. If Linear reports the persisted
 * attachment id missing (manual deletion) the slot is recreated.
 *
 * A source file may produce up to two slots — the raw .md and, when
 * `specAttachmentFormats` includes "pdf", a pdfkit-rendered PDF mirror.
 * Both share the same source-file sha so the PDF skip-decision tracks
 * the markdown content directly.
 *
 * The supporting pieces live under `./spec-attachments/`: shared types and
 * slot specs in `model`, state read/persist in `state-store`, source
 * composition and seal/trigger helpers in `compose`, and the per-slot sync
 * engine in `slot-sync`.
 */

import {
  SLOT_SPECS,
  type AttachmentFormat,
  type Slot,
  type SpecAttachmentsDeps,
} from "./spec-attachments/model";
import { purgeLegacyProposalSlots, syncSlot } from "./spec-attachments/slot-sync";

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
