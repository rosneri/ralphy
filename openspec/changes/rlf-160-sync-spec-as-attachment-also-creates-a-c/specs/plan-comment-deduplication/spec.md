# Plan comment deduplication when spec attachments are enabled

## MODIFIED Requirements

### Requirement: Plan comment is suppressed when spec attachments are enabled

When `cfg.linear.syncSpecsAsAttachments` is `true`, the `syncTasks` callback in `createCommentSyncHooks` MUST NOT post a "📋 Ralph plan" comment. The plan is already synced to Linear as an attachment; a duplicate comment would clutter the issue timeline. When `syncSpecsAsAttachments` is `false` or absent, the plan comment SHALL continue to be posted as before.

#### Scenario: spec attachments enabled — no plan comment is created

Given `cfg.linear.syncSpecsAsAttachments` is `true`
And planning is complete (all `## Planning` checkboxes are checked)
And `proposal.md` contains `## Why` and `## What Changes` sections
When `syncTasks` is invoked
Then `postPlanCommentOnce` does not create a new Linear comment
And the spec is uploaded/updated as a Linear attachment via `syncSpecAttachments`

#### Scenario: spec attachments disabled — plan comment is still created

Given `cfg.linear.syncSpecsAsAttachments` is `false` (or absent)
And planning is complete
And `proposal.md` contains `## Why` and `## What Changes` sections
When `syncTasks` is invoked
Then `postPlanCommentOnce` creates the "📋 Ralph plan" Linear comment as before
