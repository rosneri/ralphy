# shared-state-store Specification

## Purpose

TBD - created by archiving change rlf-92-stage-3-shared-state-schema-adopt-invari. Update Purpose after archive.

## Requirements

### Requirement: `writeField` MUST reject writes from an unowned feature

The new module `packages/core/src/state/store.ts` MUST export
`writeField(changeDir, featureName, path, value)`. The function MUST
consult a static ownership table that maps each top-level slot under
`.ralph-state.json` to the single feature name allowed to write it.
Writes that violate the ownership table MUST throw `OwnershipError`
without touching the file. Writes that respect ownership MUST perform
an atomic read-merge-write so unrelated slots are preserved.

The ownership table MUST at minimum register the following
feature → slot pairs:

- `linear-attachments` → `specAttachments.*`
- `linear-comments` → `linearComments.*`
- `confirmation` → `confirmation.*`
- `review` → `review.*`

#### Scenario: owner writes its slot

- **Given** a `.ralph-state.json` containing a `linearComments` slot
- **When** `writeField(dir, "linear-attachments", "specAttachments.proposal", value)` is invoked
- **Then** the call resolves
- **And** the on-disk state shows the new `specAttachments.proposal` value
- **And** `linearComments` is unchanged

#### Scenario: non-owner is rejected

- **Given** any `.ralph-state.json`
- **When** `writeField(dir, "review", "specAttachments.proposal", value)` is invoked
- **Then** the call throws `OwnershipError`
- **And** the file on disk is unchanged

### Requirement: `StateSchema` MUST carry an optional `review` slot with watermark

The zod `StateSchema` in `@ralphy/types` MUST add an optional `review`
object containing `lastConsumedCommentAt: string | null` with a default
value of `{ lastConsumedCommentAt: null }`. A state file written by
stage ≤2 (no `review` key) MUST parse cleanly under the new schema and
gain the default slot, which MUST be persisted on the next
`writeState` invocation. The `version` field MUST remain `"2"` — this
is an additive change.

#### Scenario: legacy state file parses and gains default slot

- **Given** a `.ralph-state.json` with no `review` key
- **When** `readState(dir)` is invoked
- **Then** the returned object's `review.lastConsumedCommentAt` is `null`

### Requirement: Spec-attachments syncer MUST expose `adopt()` and be idempotent on empty state

`apps/agent/src/agent/linear-sync/spec-attachments.ts` MUST expose an
`adopt()` step (separable from upload) that, given an issue id and a
slot, queries Linear for an existing attachment with that slot's title
and returns either an `adoptedId` or `null`. `syncSpecAttachments` MUST
call `adopt()` before deciding whether to create a new attachment.

When `.ralph-state.json` is empty AND the Linear issue already carries
attachments for each slot title, running `syncSpecAttachments` twice
in a row MUST NOT create any new attachments — only adopt the existing
ones and refresh the persisted sha. Persistence MUST go through
`writeField("linear-attachments", "specAttachments.<slot>", value)`.

#### Scenario: twice on empty state with remote attachments — zero creates

- **Given** an empty `.ralph-state.json`
- **And** a Linear issue with four attachments matching the four slot titles
- **When** `syncSpecAttachments` is invoked twice
- **Then** `createAttachmentForUrl` is never called
- **And** each slot in `.ralph-state.json` carries the adopted attachment id

### Requirement: Review flow MUST consult `review.lastConsumedCommentAt`

The code-review scanner in `apps/agent/src/agent/wire.ts` MUST read
`state.review.lastConsumedCommentAt` before deciding whether to enqueue
a review trigger for a given reviewer comment. A comment whose
`createdAt` is `<=` the persisted watermark MUST be ignored. When the
scanner enqueues a review, it MUST write the newest consumed
`createdAt` back via
`writeField("review", "review.lastConsumedCommentAt", iso)`.

#### Scenario: same comment across two polls fires once

- **Given** a reviewer comment with `createdAt = "2026-05-20T10:00:00Z"`
- **And** an empty `review.lastConsumedCommentAt`
- **When** the review scan runs twice in succession with no new comments
- **Then** the review trigger is enqueued exactly once
- **And** `review.lastConsumedCommentAt` equals `"2026-05-20T10:00:00Z"` after the first poll

### Requirement: `PollContext.fetchPrOnce` MUST memoize within one poll

A new `PollContext` constructed once per poll cycle MUST expose
`fetchPrOnce(url, fields[])` that memoizes by `url` + sorted-fields key
and returns the cached promise for the lifetime of the poll. Two
callers requesting the same URL+fields within one poll MUST result in
exactly one underlying `gh pr view` invocation. A fresh `PollContext`
is constructed on the next poll cycle.

#### Scenario: two callers share one subprocess

- **Given** a single `PollContext`
- **When** two callers invoke `fetchPrOnce(url, ["state","mergeable"])`
- **Then** the underlying `cmd.run(["gh","pr","view",url,…])` is invoked exactly once
