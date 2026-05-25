# Tasks for RLF-160

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-160/sync-spec-as-attachment-also-creates-a-comment-after-approved and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] In `apps/agent/src/agent/wire/comment-sync.ts`, wrap the `postPlanCommentOnce()` call with `if (!specAttachmentsEnabled)` so it is skipped when spec attachments are enabled
- [ ] Add a test in `apps/agent/src/__tests__/linear-comment-sync.test.ts` verifying that `postPlanCommentOnce` is NOT called (no plan comment is created) when spec attachments are enabled via the wire layer
- [ ] Add a test verifying that `postPlanCommentOnce` IS still called when spec attachments are disabled
- [ ] Run `bun run lint` and fix any lint errors
- [ ] Run `bun run test` and confirm all tests pass
