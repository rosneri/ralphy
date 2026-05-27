# Tasks for RLF-172

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-172/pr-draft-until-ready and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Add `prDraft: z.boolean().default(false)` to `WorkflowConfigSchema` in `packages/workflow/src/schema.ts`
- [x] Add `prDraft: z.boolean().default(false)` to `StateSchema` in `packages/types/src/types.ts`
- [x] Add `prDraft?: boolean` to `BuildInitialStateOptions` in `packages/core/src/state.ts` and pass it through to `StateSchema.parse`
- [x] Add `prDraft?: boolean` to `LoopOptions` in `packages/core/src/loop.ts`; update `buildTaskPrompt` to add `--draft` when both `state.createPr` and `state.prDraft` are true
- [x] Add `draft?: boolean` to `CreatePrInput` in `apps/agent/src/agent/pr.ts`; pass `--draft` flag to `gh pr create` when `draft === true`
- [x] Add `prDraft?: boolean` to `PostTaskInput.cfg` in `apps/agent/src/agent/post-task.ts`; add `"pr-ready"` to `PostTaskPhase`; thread `draft` into `createPrWithRetry`/`createPullRequest`; in `runPrPhase`, defer auto-merge if `prDraft` and call `gh pr ready` after CI loop succeeds
- [x] Add `prDraft: cfg.prDraft` to the `cfg` block in `runPostTask` call in `apps/agent/src/agent/wire/spawn/worker.ts`
- [x] Add `gh pr ready` handler to `apps/agent/test/harness/fake-gh.ts` (sets `pr.draft = false`)
- [x] Add tests in `apps/agent/src/__tests__/pr.test.ts` for `draft: true` → `--draft` in argv, and `draft: false` → no `--draft`
- [x] Add tests in `apps/agent/src/__tests__/post-task.test.ts` for: (a) `prDraft: true` calls `gh pr ready` after CI, (b) `prDraft: true` + auto-merge defers merge until after `gh pr ready`, (c) `prDraft: false` has no `gh pr ready` call, (d) `gh pr ready` failure logs warning and skips auto-merge
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and fix any failures
