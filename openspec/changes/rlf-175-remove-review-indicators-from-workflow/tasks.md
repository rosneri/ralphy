# Tasks for RLF-175

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-175/remove-review-indicators-from-workflow and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Remove `getReview` and `clearReview` from the `Indicators` interface in `packages/types/src/types.ts`
- [x] Remove `"clearReview"` from `SET_INDICATOR_KEYS` and drop `getReview` / `clearReview` from `IndicatorsSchema` in `packages/workflow/src/schema.ts`; remove the `"clearReview"` entry from the `superRefine` label-only validation array
- [x] Delete the commented-out review hand-off block from the default WORKFLOW.md template in `packages/workflow/src/default.ts`
- [x] Remove `excludeFromReview`, the `fetchReview` resolver, and the `clearReview` coordinator option from `apps/agent/src/agent/wire.ts`
- [x] Remove `clearReview` option, the `fetchReview` dependency, and the review-trigger `clearReview` application block from `apps/agent/src/runtime/coordinator.ts`
- [x] Remove the `review=[...]` log line from `describeIndicators` in `apps/agent/src/agent/wire/indicators.ts`
- [x] Remove the review bucket from the `ralph list` output in `apps/agent/src/list.ts`
- [x] Delete `clearReview`-related tests from `packages/workflow/src/__tests__/workflow.test.ts` and `apps/agent/src/__tests__/agent.test.ts`
- [x] Update `apps/agent/src/__tests__/e2e-pr-lifecycle-s10.test.ts` to remove `getReview` / `clearReview` fixture setup
- [x] Run `bun run lint` and fix any type/lint errors
- [x] Run `bun run test` and confirm all tests pass
