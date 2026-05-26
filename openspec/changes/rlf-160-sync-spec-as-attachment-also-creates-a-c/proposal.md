# RLF-160: Sync spec as attachment also creates a comment after approved

Source: [RLF-160](https://linear.app/neriros/issue/RLF-160/sync-spec-as-attachment-also-creates-a-comment-after-approved)
Status: In Progress
Assignee: Neriya Rosner
Labels: Bug

## Why

When `syncSpecsAsAttachments` is enabled, the spec (proposal + design) is uploaded as a Linear attachment on each iteration. However, the `syncTasks` callback in `wire/comment-sync.ts` always calls `postPlanCommentOnce()`, which additionally creates a "📋 Ralph plan" comment containing the proposal content. This means the plan appears twice on the Linear issue — once as an attachment and once as a comment — which is redundant and clutters the issue timeline.

The user's intent is for the attachment to be the canonical location of the spec when `syncSpecsAsAttachments` is on; the separate plan comment should not be created in that case.

## What Changes

- `apps/agent/src/agent/wire/comment-sync.ts`: skip the `postPlanCommentOnce()` call when `specAttachmentsEnabled` is true, so the plan is synced only as an attachment and not also as a comment.
- `apps/agent/src/__tests__/linear-comment-sync.test.ts`: add tests verifying `postPlanCommentOnce` is skipped when spec attachments are enabled (tested via the wire layer).

## Steering

_Add steering notes here as the loop runs._
