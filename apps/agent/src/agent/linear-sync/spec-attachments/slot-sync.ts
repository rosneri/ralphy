/**
 * The per-slot sync engine: upload + adopt-or-create the design attachment
 * (and its PDF mirror) in place pre-seal, append versioned revisions
 * post-seal, and purge the legacy proposal slots. Pure mechanics over the
 * shared model, state store, and compose helpers.
 */

import { isCommentNotFoundError } from "../comment-sync";
import { writeField } from "@ralphy/core/state";
import { composeSpecSource, isDesignSealed, resolveTriggerLabel, versionedTitle } from "./compose";
import {
  EMPTY_SLOT,
  LEGACY_SLOT_TITLES,
  REVISIONS_KEY,
  SLOT_SPECS,
  type LegacySlot,
  type Slot,
  type SpecAttachmentsDeps,
  type SpecAttachmentsState,
} from "./model";
import {
  persistRevision,
  persistSlot,
  readSpecAttachments,
  readSpecAttachmentsSubtree,
  stateDirOf,
} from "./state-store";

/** Build a Linear-API error suffix surfacing .status / .body / .messages from
 *  linearRequest; without it every HTTP failure collapses to the generic
 *  "Linear API request failed", hiding 4xx vs 5xx. */
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

function logSkip(deps: SpecAttachmentsDeps, message: string): void {
  (deps.fileLog ?? deps.log)(message, "gray");
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

/**
 * Sealed (post-PR) path for one design slot in **append** mode. The v1
 * attachment and any prior revisions are **never** deleted. A changed design
 * publishes a new additional attachment titled `Ralph design #<n> (<label>)`:
 *
 *   1. Skip (no network) if `hash` equals the v1 slot sha256 or any recorded
 *      revision sha256 — re-syncing identical content is a no-op.
 *   2. Otherwise compute `n = 2 + revisions.length`, derive the trigger
 *      label, render + upload the bytes, **adopt-or-create** the versioned
 *      title (look up first; on miss create), and append the revision.
 *
 * `hash` is the **design-only** hash (sha256 of `design.md` alone), so a
 * checkbox-only tick of the `tasks.md` Implementation checklist — which leaves
 * `design.md` unchanged — yields the same hash as the last revision and is a
 * no-op. The uploaded bytes still render from the **composed** `sourceBytes`
 * (design.md + tasks.md Implementation), so published content is unchanged;
 * only the change-detection key narrows. The persisted revision records the
 * design-only `hash`.
 */
async function syncSlotSealed(
  deps: SpecAttachmentsDeps,
  slot: Slot,
  sourceBytes: Uint8Array,
  hash: string,
  state: SpecAttachmentsState,
): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const revisions = state[REVISIONS_KEY[slot]];
  const v1Sha = state[slot]?.sha256 ?? null;

  // Idempotent: identical bytes to v1 or any published revision → no-op.
  if (hash === v1Sha || revisions.some((r) => r.sha256 === hash)) {
    logSkip(deps, `  spec-attachments: ${spec.uploadFilename} unchanged (sealed), skipping`);
    return;
  }

  const n = 2 + revisions.length;
  const label = await resolveTriggerLabel(stateDirOf(deps.statePath));
  const title = versionedTitle(slot, n, label);

  let uploadBytes: Uint8Array;
  try {
    uploadBytes = await spec.renderBytes(sourceBytes);
  } catch (err) {
    deps.log(
      `! spec-attachments: render ${spec.uploadFilename} (sealed) failed: ${(err as Error).message}`,
      "yellow",
    );
    return;
  }

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
      `! spec-attachments: upload ${spec.uploadFilename} (sealed) failed: ${describeLinearError(err)}`,
      "yellow",
    );
    return;
  }

  // Adopt-or-create: if an attachment with this exact versioned title
  // already exists (e.g. state was wiped but the attachment survived),
  // adopt its id rather than creating a duplicate. Lookup failure falls
  // through to create (mirrors the v1 adopt() resilience).
  let attachmentId: string | null = null;
  try {
    attachmentId = await deps.mutations.findIssueAttachmentByTitle(
      deps.apiKey,
      deps.issueId,
      title,
    );
    if (attachmentId) {
      deps.log(`  spec-attachments: adopted existing ${title} attachment ${attachmentId}`, "gray");
    }
  } catch (err) {
    deps.log(
      `! spec-attachments: findIssueAttachmentByTitle ${title} failed (treating as no match): ${describeLinearError(err)}`,
      "yellow",
    );
    attachmentId = null;
  }

  if (!attachmentId) {
    try {
      attachmentId = await deps.mutations.createAttachmentForUrl(deps.apiKey, {
        issueId: deps.issueId,
        url: assetUrl,
        title,
        subtitle: `iteration ${deps.iteration}`,
      });
    } catch (err) {
      deps.log(
        `! spec-attachments: createAttachmentForUrl ${title} failed: ${describeLinearError(err)}`,
        "yellow",
      );
      return;
    }
    deps.log(`  spec-attachments: created ${title} attachment`, "gray");
  }

  await persistRevision(deps.statePath, slot, [
    ...revisions,
    { version: n, attachmentId, sha256: hash, trigger: label },
  ]);
}

export async function syncSlot(deps: SpecAttachmentsDeps, slot: Slot): Promise<void> {
  const spec = SLOT_SPECS[slot];
  const source = await composeSpecSource(deps.changeDir, deps.log, spec.sourceFiles);
  if (!source) return;
  const { sourceBytes, hash, designOnlyHash } = source;
  const state = await readSpecAttachments(deps.statePath);

  const sealed = await isDesignSealed(stateDirOf(deps.statePath));
  const mode = deps.sealedRevisionMode ?? "append";

  // Once the change is sealed (a PR exists) in append mode, publish a changed
  // design as a new versioned attachment instead of overwriting v1 in place.
  // Pre-seal — and sealed+replace — fall through to the in-place path below.
  if (sealed && mode === "append") {
    await syncSlotSealed(deps, slot, sourceBytes, designOnlyHash, state);
    return;
  }

  // Skip/persist hash: pre-seal compares the composed hash (so task edits
  // still refresh the attachment before a PR exists); sealed+replace compares
  // the design-only hash (so checkbox ticks don't churn the attachment).
  const skipHash = sealed ? designOnlyHash : hash;

  let current = state[slot] ?? EMPTY_SLOT;

  // Empty cache: ask Linear whether an attachment with this slot's title
  // already exists on the issue. Adopting it prevents a duplicate when
  // .ralph-state.json is wiped or the worktree is re-scaffolded.
  if (!current.attachmentId) {
    const { adoptedId } = await adopt(deps, slot);
    if (adoptedId) {
      current = { attachmentId: adoptedId, sha256: null };
    }
  }

  if (current.attachmentId && current.sha256 === skipHash) {
    logSkip(deps, `  spec-attachments: ${spec.uploadFilename} unchanged, skipping`);
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
  await persistSlot(deps.statePath, slot, { attachmentId: newId, sha256: skipHash });
  deps.log(`  spec-attachments: created ${spec.uploadFilename} attachment`, "gray");
}

/** Delete any pre-existing proposal / proposalPdf attachments left over
 *  from before we consolidated everything into the design slot. Runs once
 *  per change: persists `legacyProposalPurged: true` in state so the
 *  Linear lookup is not repeated every sync. */
export async function purgeLegacyProposalSlots(deps: SpecAttachmentsDeps): Promise<void> {
  const sa = await readSpecAttachmentsSubtree(deps.statePath);
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
