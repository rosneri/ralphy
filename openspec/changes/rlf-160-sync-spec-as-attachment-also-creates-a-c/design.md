# Design for RLF-160

## Problem

In `apps/agent/src/agent/wire/comment-sync.ts`, the `syncTasks` callback (lines 57–92) unconditionally calls `postPlanCommentOnce()` before optionally calling `syncSpecAttachments()`. When `syncSpecsAsAttachments` is enabled both run, causing the proposal/design content to appear as both a Linear attachment and a comment on the issue.

## Root Cause

The `postPlanCommentOnce()` call has no awareness of `specAttachmentsEnabled`. The two features were added independently and there is no guard preventing them from running together.

## Fix

Add a conditional in `createCommentSyncHooks` to skip `postPlanCommentOnce()` when `specAttachmentsEnabled` is `true`:

```ts
// wire/comment-sync.ts — inside syncTasks callback
if (!specAttachmentsEnabled) {
  await postPlanCommentOnce({ ... });
}
```

This is the minimal, targeted fix. No new state, no new config flags, no API changes. When `syncSpecsAsAttachments` is disabled (the non-attachment path), `postPlanCommentOnce()` still runs exactly as before.

## Files to Touch

- `apps/agent/src/agent/wire/comment-sync.ts` — add the `if (!specAttachmentsEnabled)` guard around the `postPlanCommentOnce` call.
- `apps/agent/src/__tests__/linear-comment-sync.test.ts` — add test coverage via `postPlanCommentOnce` directly (the guard lives in the wire layer; the unit test can verify the guard logic at that level by testing `createCommentSyncHooks` or by directly calling `postPlanCommentOnce` and confirming it still works when attachments are off).

## Edge Cases

- Existing issues that already have a plan comment (from before this fix): the `planCommentId` is persisted in state, so `postPlanCommentOnce` would have been a no-op for them anyway — no action needed.
- Toggling `syncSpecsAsAttachments` off after it was on: `postPlanCommentOnce` will resume on the next iteration. This is acceptable — the existing guard (`if (comments.planCommentId) return null`) prevents double-posting.
- The `postPlanReadyCommentOnce` in `awaiting.ts` is a different comment (the "awaiting approval" prompt) and is unaffected by this change.

## Data Flow

```
syncTasks callback
  ├── if (!specAttachmentsEnabled) → postPlanCommentOnce()   [NEW: guarded]
  ├── postOrUpdateTasksComment()                              [unchanged]
  └── if (specAttachmentsEnabled) → syncSpecAttachments()    [unchanged]
```
