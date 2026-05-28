# Design for RLF-182

## Problem

`syncSpecAttachments` in `apps/agent/src/agent/linear-sync/spec-attachments.ts` previously maintained two upload slots: `proposal` (sourced from `proposal.md`) and `design` (sourced from `design.md`). This produced two separate Linear attachments per change. The proposal attachment became stale once the design phase began, and there was no clear signal for stakeholders about which document was current.

## Solution

Consolidate to a single `design` slot that merges `design.md` + `tasks.md`. Remove the `proposal` slot entirely from `SLOT_SPECS`. Purge any pre-existing proposal attachments on the first sync after upgrade.

## Files Touched

### `apps/agent/src/agent/linear-sync/spec-attachments.ts`

**Slot types:**

- `Slot` is now `"design" | "designPdf"` only.
- `LegacySlot` (`"proposal" | "proposalPdf"`) is retained solely for the one-time purge path; nothing writes to these slots after purge.

**`SLOT_SPECS`:**

- `design` slot: `sourceFiles: ["design.md", "tasks.md"]`, `uploadFilename: "design.md"`, `title: "Ralph design"`.
- `designPdf` slot: same source files, pdfkit-rendered, `title: "Ralph design (PDF)"`.
- No `proposal` or `proposalPdf` entries.

**`purgeLegacyProposalSlots(deps)`:**

1. Reads raw state. If `specAttachments.legacyProposalPurged === true`, returns immediately (no Linear calls on subsequent syncs).
2. For each legacy slot (`proposal`, `proposalPdf`):
   - Checks the recorded `attachmentId` from state, or falls back to `findIssueAttachmentByTitle` with the legacy title.
   - If an id is found, calls `deleteAttachment`. Logs success (gray) or not-found (gray) or other errors (yellow, non-fatal).
   - Clears the slot in state if it had a recorded id.
3. Writes `specAttachments.legacyProposalPurged = true` via `writeField`.

**`syncSpecAttachments(deps)`:**

1. Calls `purgeLegacyProposalSlots(deps)` first.
2. Iterates only `["design", "designPdf"]`, skipping slots not in the enabled `formats` set.

### `openspec/specs/linear-spec-attachments/spec.md`

The global spec must be updated to:

- Remove the "Sync MUST upload `proposal.md` and `design.md` on first run" requirement and its scenarios.
- Add a "Sync MUST upload design.md (with tasks.md appended) only" requirement with the new scenarios.
- Remove stale scenarios that reference proposal slots as a normal upload path (e.g. "first-time sync uploads both files", "unchanged content skips upload" referencing proposal).
- Retain and update resilience requirements to reference only design slots.

### `apps/agent/src/__tests__/linear-spec-attachments-design-only.test.ts`

New test file (added in commit `7a34385`):

- **fix_case**: with `proposal.md`, `design.md`, and `tasks.md` on disk and a pre-existing proposal attachment in state, verifies that only `design.md` is uploaded (bytes contain both design and tasks content) and the legacy proposal attachment is deleted.
- **regression**: verifies `proposal.md` is never uploaded as its own attachment under any conditions.

## State Schema

`.ralph-state.json` → `specAttachments`:

| Field                  | Written by                 | Purpose                            |
| ---------------------- | -------------------------- | ---------------------------------- |
| `design.attachmentId`  | `syncSlot`                 | Tracks active design attachment id |
| `design.sha256`        | `syncSlot`                 | Content hash for skip-on-no-change |
| `designPdf.*`          | `syncSlot`                 | Same, for PDF mirror               |
| `proposal.*`           | (read-only)                | Only read during legacy purge      |
| `proposalPdf.*`        | (read-only)                | Only read during legacy purge      |
| `legacyProposalPurged` | `purgeLegacyProposalSlots` | Prevents repeat Linear lookup      |

## Edge Cases

- **No proposal attachment exists on Linear**: `findIssueAttachmentByTitle` returns null; nothing is deleted; `legacyProposalPurged` is still set to prevent future lookups.
- **Proposal attachment already manually deleted**: `deleteAttachment` throws a not-found error (caught via `isCommentNotFoundError`); logged as gray; purge flag is still set.
- **State wiped / fresh worktree**: `legacyProposalPurged` absent; purge runs the title lookup once, then sets the flag; the adopt path handles missing `design.attachmentId` as usual.
- **PDF format enabled**: `designPdf` sources from the same `["design.md", "tasks.md"]` as `design`; both share the composed-source hash so a tasks.md change invalidates both slots together.
- **tasks.md missing**: `syncSlot` silently skips the trailing file; the design attachment contains only `design.md` content.
