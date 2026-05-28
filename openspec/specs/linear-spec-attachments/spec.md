# linear-spec-attachments Specification

## Purpose

TBD - created by archiving change rlf-74-add-a-sync-spec-config. Update Purpose after archive.

## Requirements

### Requirement: The workflow config MUST expose `linear.syncSpecsAsAttachments`

`WorkflowConfigSchema` in `packages/workflow/src/schema.ts` MUST add a
boolean `syncSpecsAsAttachments` field to the `linear` block, defaulting
to `true`. The default `WORKFLOW.md` shipped by `ralph init` MUST document
the new key alongside `syncTasksToComment`.

When the flag is `false`, the agent MUST NOT call any Linear file-upload
or attachment-mutation API on behalf of openspec files. When the flag is
`true` AND a Linear API key is configured AND `syncTasksToComment` is
`true`, the agent MUST run the spec-attachment sync described below on
every `syncTasks` poll for every active worker.

#### Scenario: flag defaults to true

- **Given** a `WORKFLOW.md` with no explicit `linear.syncSpecsAsAttachments`
- **When** `parseWorkflow` parses it
- **Then** `cfg.linear.syncSpecsAsAttachments === true`

#### Scenario: flag disabled skips upload

- **Given** `linear.syncSpecsAsAttachments: false` in WORKFLOW.md
- **When** the coordinator's `syncTasks` hook fires for an active worker
- **Then** no Linear `fileUpload` or `attachmentCreate` mutation is
  invoked for `design.md`

### Requirement: Sync MUST upload `design.md` (with `tasks.md` embedded) only — never `proposal.md`

The agent MUST mirror only the `design` slot to the parent Linear issue
as a native attachment. The orchestrator lives in a new module
`apps/agent/src/agent/linear-sync/spec-attachments.ts` exporting
`syncSpecAttachments(deps)` which, when enabled and given an active
worker, MUST:

1. Locate `design.md` inside `openspec/changes/<changeName>/`.
2. Build the upload bytes by combining `design.md` content with the
   contents of `tasks.md` (if present) appended as a trailing section.
   If `tasks.md` is missing, upload `design.md` bytes alone.
3. Compute a SHA-256 hash of the combined bytes via `Bun.CryptoHasher`.
4. Purge any legacy `proposal` attachment: if `.ralph-state.json`
   records a `specAttachments.proposal` entry, call `deleteAttachment`
   for that id and clear the state entry.
5. Read `.ralph-state.json` and look up `specAttachments.design`.
6. When no persisted `design` record exists, check whether Linear
   already has an attachment titled `"Ralph design"` via
   `findIssueAttachmentByTitle`. If one is found, delete it and
   re-create to take ownership (adoption flow). Then call
   `uploadFileToLinear` to obtain a signed asset URL and call
   `createAttachmentForUrl` with `title: "Ralph design"` and
   `subtitle: "iteration N"`. Persist the new attachment id and the
   SHA-256 hash under `specAttachments.design` in `.ralph-state.json`.
7. When a persisted record exists and the hash matches, the sync MUST
   skip the upload (no Linear network calls).
8. When a persisted record exists and the hash differs, the sync MUST
   delete the old attachment via `deleteAttachment`, upload the new
   bytes via `uploadFileToLinear`, and create a new attachment via
   `createAttachmentForUrl`. The persisted id and hash MUST be replaced
   on success.

`proposal.md` MUST NOT be uploaded, created, or attached to the Linear
issue under any circumstances.

#### Scenario: first-time sync uploads design.md with tasks embedded

- **Given** `design.md` and `tasks.md` exist for the change and
  `.ralph-state.json` has no `specAttachments` block
- **When** `syncSpecAttachments` runs
- **Then** `uploadFileToLinear` is called once with `filename: "design.md"`
  and the upload bytes contain both the design content and the tasks content
- **And** `createAttachmentForUrl` is called once with `title: "Ralph design"`
- **And** `.ralph-state.json` now contains `specAttachments.design.attachmentId`
  and `specAttachments.design.sha256`
- **And** `uploadFileToLinear` is never called with `filename: "proposal.md"`

#### Scenario: unchanged content skips upload

- **Given** persisted `specAttachments.design.sha256` matches the
  current combined `design.md` + `tasks.md` hash
- **When** `syncSpecAttachments` runs
- **Then** `uploadFileToLinear` and `createAttachmentForUrl` are NOT called

#### Scenario: changed content deletes old attachment and creates a new one

- **Given** persisted `specAttachments.design.sha256` differs from the
  current combined hash, and `specAttachments.design.attachmentId` is a known
  attachment id
- **When** `syncSpecAttachments` runs
- **Then** `deleteAttachment` is called with the persisted attachment id
- **And** `uploadFileToLinear` is called once for the design slot
- **And** `createAttachmentForUrl` is called once with `title: "Ralph design"`
- **And** the persisted `attachmentId` and `sha256` are replaced with the new values

#### Scenario: legacy proposal attachment is purged

- **Given** `.ralph-state.json` records `specAttachments.proposal.attachmentId`
  from a previous run
- **When** `syncSpecAttachments` runs
- **Then** `deleteAttachment` is called for the legacy proposal attachment id
- **And** no `proposal.md` upload or create occurs

### Requirement: Sync MUST be resilient to missing files and API errors

- A missing `design.md` MUST be logged as a gray line
  (`spec-attachments: design.md missing, skipping`) and MUST NOT
  cause any upload or attachment calls.
- A missing or empty Linear API key MUST short-circuit the orchestrator
  without making any network calls.
- A `fileUpload`, `createAttachmentForUrl`, or `deleteAttachment` failure
  MUST be logged at yellow level with the message from
  `formatLinearError` and MUST NOT update `.ralph-state.json` for the
  design slot, so the next iteration retries.
- A `deleteAttachment` that returns a "not found" / "could not find"
  error (manually deleted attachment) MUST be treated as already gone
  and fall through to a fresh `createAttachmentForUrl`, persisting the
  replacement id under `specAttachments.design`.

#### Scenario: design.md missing skips all upload calls

- **Given** `design.md` does not exist for the change
- **When** `syncSpecAttachments` runs
- **Then** `uploadFileToLinear` is NOT called
- **And** a gray `spec-attachments: design.md missing, skipping` log line
  is emitted

#### Scenario: upload error leaves state untouched

- **Given** no persisted `specAttachments.design` and
  `uploadFileToLinear` throws
- **When** `syncSpecAttachments` runs
- **Then** a yellow error line is logged
- **And** `.ralph-state.json` still has no `specAttachments.design`
  block

#### Scenario: stale attachment id recreates

- **Given** persisted `specAttachments.design.attachmentId = "att_old"` and
  Linear's `deleteAttachment` for that id returns a not-found error
- **When** `syncSpecAttachments` runs against changed `design.md`
- **Then** `createAttachmentForUrl` is called for the design slot
- **And** `specAttachments.design.attachmentId` is replaced with the new
  attachment id in `.ralph-state.json`

### Requirement: Sync MUST skip uploads when the source file has no meaningful content

`syncSpecAttachments` MUST skip the upload, create, delete, and update
calls for any slot whose source markdown contains no meaningful
content, and MUST leave `.ralph-state.json` untouched for that slot.

Before computing a hash or invoking any Linear network call,
`syncSpecAttachments` MUST check whether the source markdown contains
any _meaningful_ content. A line counts as scaffold noise when it is
blank after trim, starts with `#`, matches the italic-only pattern
`^_.+_$`, or starts with one of `Source:`, `Status:`, `Assignee:`,
`Labels:`. A file is meaningful iff at least one line is not scaffold
noise.

When the source file is not meaningful, the sync MUST:

- log a gray `spec-attachments: <filename> has no content yet, skipping`
  line, and
- return without uploading, creating, deleting, or updating any Linear
  attachment for that slot, and
- leave `.ralph-state.json` untouched for that slot so a later iteration
  retries automatically once real content lands.

This gate MUST apply equally to markdown slots and to their PDF mirror
slots, since the PDF render is driven by the same source-md bytes.

#### Scenario: scaffolded design.md is not uploaded

- **Given** `design.md` exists and contains only a `# Design for FOO`
  heading and a single `_Fill in the technical design as you work
through the issue._` placeholder line
- **And** `.ralph-state.json` has no `specAttachments.design` block
- **When** `syncSpecAttachments` runs
- **Then** `uploadFileToLinear` and `createAttachmentForUrl` are NOT
  called for the design slot
- **And** a gray `spec-attachments: design.md has no content yet,
skipping` line is logged
- **And** `.ralph-state.json` still has no `specAttachments.design`
  block

#### Scenario: empty placeholder later becomes meaningful

- **Given** the previous run skipped `design.md` because it contained
  only scaffold noise
- **When** real content is added to `design.md` and `syncSpecAttachments`
  runs again
- **Then** the design slot uploads as normal via `uploadFileToLinear`
  and `createAttachmentForUrl`
- **And** `specAttachments.design.sha256` is now persisted in
  `.ralph-state.json`
