# RLF-182: Confirmation mode

Source: [RLF-182](https://linear.app/neriros/issue/RLF-182/confirmation-mode)
Status: In Progress
Assignee: Neriya Rosner

## Why

Uploading `proposal.md` as a separate Linear attachment creates noise for anyone reviewing an in-progress change. The proposal captures early thinking that becomes stale once the design phase begins. By the time a stakeholder looks at the Linear issue, the design document is the authoritative artifact. Having two separate attachments forces reviewers to decide which is current, adding unnecessary friction.

Consolidating into a single **design** attachment (with `tasks.md` appended) gives reviewers one document that reflects the current state of the change at every iteration, and signals clearly that "Ralph design" is the single source of truth.

## What Changes

- The `proposal` and `proposalPdf` upload slots are removed from `SLOT_SPECS` in `apps/agent/src/agent/linear-sync/spec-attachments.ts`.
- `syncSpecAttachments` uploads only `design.md` (with `tasks.md` content appended after a `---` separator) as the single "Ralph design" attachment.
- A `purgeLegacyProposalSlots()` helper runs on the first sync after upgrade to delete any pre-existing "Ralph proposal" and "Ralph proposal (PDF)" attachments from Linear, and writes `specAttachments.legacyProposalPurged: true` to state so the Linear lookup is not repeated.
- The `LegacySlot` type (`"proposal" | "proposalPdf"`) is retained in state types only for the one-time purge; it is never re-uploaded.
- The global spec `openspec/specs/linear-spec-attachments/spec.md` is updated to replace the old "upload both proposal and design" requirement with the new design-only requirement.

## Acceptance Criteria

- A Linear issue for an active change has **at most one markdown attachment** (titled "Ralph design") and at most one optional PDF mirror — never a "Ralph proposal" attachment.
- `proposal.md` is never uploaded to Linear under any circumstances.
- The "Ralph design" attachment contains the full `design.md` content followed by `tasks.md` content (with a `---` separator) when `tasks.md` is present.
- Pre-existing "Ralph proposal" or "Ralph proposal (PDF)" attachments are deleted on the first sync after upgrade; subsequent syncs do not repeat the Linear lookup.
- All existing and new tests in `apps/agent/src/__tests__/linear-spec-attachments*.test.ts` pass.
- `bun run lint` reports no errors.

## Additional instructions

You are working on RLF-182: Confirmation mode.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
