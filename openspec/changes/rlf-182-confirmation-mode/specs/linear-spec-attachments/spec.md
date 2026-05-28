# Linear spec attachments — design-only upload

## MODIFIED Requirements

### Requirement: Sync MUST upload design.md (with tasks.md appended) only — proposal slot removed

`syncSpecAttachments` MUST upload only `design.md` content as the "Ralph design" attachment. When `tasks.md` exists and is non-empty, its content MUST be appended to the upload payload after a `---` markdown separator. The `proposal` slot is removed entirely — `proposal.md` MUST NOT be uploaded to Linear under any circumstances.

On the first sync after upgrade, `syncSpecAttachments` MUST delete any pre-existing "Ralph proposal" or "Ralph proposal (PDF)" attachments from Linear (found via persisted state or `findIssueAttachmentByTitle`) and persist `specAttachments.legacyProposalPurged: true` so the lookup is never repeated.

#### Scenario: proposal.md is never uploaded

- **Given** `proposal.md`, `design.md`, and `tasks.md` all exist for the change
- **When** `syncSpecAttachments` runs
- **Then** `uploadFileToLinear` is NOT called with `filename: "proposal.md"`
- **And** `createAttachmentForUrl` is NOT called with `title: "Ralph proposal"`
- **And** exactly one markdown upload occurs, for `design.md`

#### Scenario: design attachment embeds tasks content

- **Given** `design.md` contains meaningful content and `tasks.md` exists with task items
- **When** `syncSpecAttachments` runs
- **Then** the uploaded bytes for `design.md` contain the design content followed by the tasks content
- **And** the two sections are separated by a `---` markdown rule

#### Scenario: legacy proposal attachments are purged on first sync

- **Given** `.ralph-state.json` has `specAttachments.proposal.attachmentId = "att-old"` from a prior run
- **When** `syncSpecAttachments` runs
- **Then** `deleteAttachment` is called with `"att-old"`
- **And** `specAttachments.legacyProposalPurged` is set to `true` in `.ralph-state.json`
- **And** `findIssueAttachmentByTitle` is NOT called for legacy slots on the next sync run
