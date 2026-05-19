# Tasks for RLF-74

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-74/add-a-sync-spec-config and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `syncSpecsAsAttachments: boolean` (default `true`) to the `linear` block of `WorkflowConfigSchema` in `packages/workflow/src/schema.ts`, including the matching key in the schema-level `.default({...})`
- [x] Document the new option in the default WORKFLOW.md (`packages/workflow/src/default.ts`) and the repo-root `WORKFLOW.md`, mirroring the comment-style used for `syncTasksToComment`
- [x] Add Linear file-upload helpers to `apps/agent/src/agent/linear.ts`:
  - `uploadFileToLinear(apiKey, { filename, contentType, bytes })` — runs the `fileUpload` GraphQL mutation, PUTs bytes to the returned signed URL with the headers Linear specifies, returns `{ assetUrl }`
  - `createAttachmentForUrl(apiKey, { issueId, url, title, subtitle })` — returns the new attachment id
  - `updateAttachmentUrl(apiKey, attachmentId, url, subtitle?)` — wraps `attachmentUpdate(input: { url, subtitle })`
- [x] Create `apps/agent/src/agent/linear-sync/spec-attachments.ts` exporting `syncSpecAttachments(deps)`:
  - read `proposal.md` / `design.md` via `Bun.file(...).bytes()`
  - SHA-256 hash via `Bun.CryptoHasher`
  - read/patch `.ralph-state.json` under a new `specAttachments` block
  - upload + attachmentCreate on first run, attachmentUpdate on hash change, no-op on hash match
  - reuse `isCommentNotFoundError` from `comment-sync.ts` to detect deleted attachments and fall through to recreate
- [x] Wire `syncSpecAttachments` into the `syncTasks` hook in `apps/agent/src/agent/wire.ts`, gated by `cfg.linear.syncSpecsAsAttachments && apiKey && cfg.linear.syncTasksToComment`. Pass `apiKey`, `issueId`, `statePath`, `changeDir`, `iteration`, `log`, and a `mutations` bundle exposing the three new Linear helpers
- [x] Add `apps/agent/src/__tests__/linear-spec-attachments.test.ts` covering:
  - first-time upload uploads both files and persists ids + hashes
  - unchanged content skips uploads (assert zero mutations calls per slot)
  - changed content calls `attachmentUpdate` only for the changed slot
  - missing `design.md` only skips the design slot, proposal slot still uploads
  - missing api key short-circuits (no helper called)
  - upload error logs yellow and leaves `.ralph-state.json` untouched
  - stale attachment id triggers fresh `attachmentCreate` and replaces the persisted id
- [x] Run `bunx openspec validate rlf-74-add-a-sync-spec-config` and fix any validator errors
- [x] Run `bun run lint` and address findings
- [x] Run `bun run test` and address failures (do NOT lower the coverage threshold)
- [x] Stage the changed files individually (`git add path/...`) and commit with a single message summarising the change
