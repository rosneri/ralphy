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
  invoked for `proposal.md` or `design.md`

### Requirement: Sync MUST upload `proposal.md` and `design.md` on first run

The agent MUST mirror `proposal.md` and `design.md` from
`openspec/changes/<changeName>/` to the parent Linear issue as native
attachments, in place, with the following behavior. The orchestrator
lives in a new module
`apps/agent/src/agent/linear-sync/spec-attachments.ts` exporting
`syncSpecAttachments(deps)` which, when enabled and given an active
worker, MUST:

1. Locate `proposal.md` and `design.md` inside
   `openspec/changes/<changeName>/`.
2. For each file that exists, read its bytes via `Bun.file(...).bytes()`
   and compute a SHA-256 hash via `Bun.CryptoHasher`.
3. Read `.ralph-state.json` for the change and look up
   `specAttachments.<slot>` where `slot` is `proposal` or `design`.
4. When no persisted record exists for a slot, call
   `uploadFileToLinear` to obtain a signed asset URL, then
   `attachmentCreate` with `title: "Ralphy: <slot>"` and `subtitle:
"<slot>.md (iteration N)"`. Persist the new attachment id and the
   SHA-256 hash under `specAttachments.<slot>` in `.ralph-state.json`.
5. When a persisted record exists and the hash matches, the sync MUST
   skip the upload (no Linear network calls) and MUST log a gray line
   noting the skip.
6. When a persisted record exists and the hash differs, the sync MUST
   upload the new bytes via `uploadFileToLinear` and call
   `attachmentUpdate` against the persisted attachment id to point at
   the new asset URL. The persisted hash MUST be replaced on success.

#### Scenario: first-time sync uploads both files

- **Given** `proposal.md` and `design.md` exist for the change and
  `.ralph-state.json` has no `specAttachments` block
- **When** `syncSpecAttachments` runs
- **Then** `fileUpload` is called twice and `attachmentCreate` is called
  twice
- **And** `.ralph-state.json` now contains `specAttachments.proposal.id`,
  `specAttachments.proposal.sha256`, `specAttachments.design.id`, and
  `specAttachments.design.sha256`

#### Scenario: unchanged content skips upload

- **Given** persisted `specAttachments.proposal.sha256` matches the
  current `proposal.md` hash
- **When** `syncSpecAttachments` runs
- **Then** `fileUpload` and `attachmentCreate` are NOT called for the
  proposal slot
- **And** a gray `spec-attachments: proposal unchanged` line is logged

#### Scenario: changed content updates attachment in place

- **Given** persisted `specAttachments.design.sha256` differs from the
  current `design.md` hash, and `specAttachments.design.id` is a known
  attachment id
- **When** `syncSpecAttachments` runs
- **Then** `fileUpload` is called once for the design slot
- **And** `attachmentUpdate` is called with the persisted attachment id
  and the new asset URL
- **And** the persisted `sha256` is replaced with the new hash
- **And** the persisted `id` is NOT changed

### Requirement: Sync MUST be resilient to missing files and API errors

- A missing `proposal.md` or `design.md` MUST be logged as a gray line
  (`spec-attachments: <slot>.md missing, skipping`) and MUST NOT
  prevent the other slot from syncing.
- A missing or empty Linear API key MUST short-circuit the orchestrator
  without making any network calls.
- A `fileUpload`, `attachmentCreate`, or `attachmentUpdate` failure
  MUST be logged at yellow level with the message from
  `formatLinearError` and MUST NOT update `.ralph-state.json` for that
  slot, so the next iteration retries.
- An `attachmentUpdate` that returns a "not found" / "could not find"
  error (manually deleted attachment) MUST fall through to a fresh
  `attachmentCreate` and persist the replacement id under the same slot,
  mirroring the recreate behaviour already used by the tasks comment.

#### Scenario: design.md missing skips only that slot

- **Given** `proposal.md` exists and `design.md` does not
- **When** `syncSpecAttachments` runs
- **Then** the proposal slot uploads as normal
- **And** the design slot is skipped with a gray
  `spec-attachments: design.md missing, skipping` log line

#### Scenario: upload error leaves state untouched

- **Given** no persisted `specAttachments.proposal` and
  `uploadFileToLinear` throws
- **When** `syncSpecAttachments` runs
- **Then** a yellow `! spec-attachments: proposal upload failed` line is
  logged
- **And** `.ralph-state.json` still has no `specAttachments.proposal`
  block

#### Scenario: stale attachment id recreates

- **Given** persisted `specAttachments.design.id = "att_old"` and
  Linear's `attachmentUpdate` for that id returns a not-found error
- **When** `syncSpecAttachments` runs against changed `design.md`
- **Then** `attachmentCreate` is called for the design slot
- **And** `specAttachments.design.id` is replaced with the new
  attachment id in `.ralph-state.json`
