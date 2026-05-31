# Tasks for RLF-190

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-190/add-review-flag-to-agent-list-unresolved-review-threads and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Create `apps/agent/src/shared/pr/review-state.ts` exporting `fetchPrReviewSummary(prUrl, runner, cwd): Promise<{ unresolved: number } | null>` using the same GraphQL query as `scan.ts:fetchPrReviewState`
- [x] Create `apps/agent/src/shared/pr/__tests__/review-state.test.ts` with unit tests covering: resolved-only threads (→ 0), mixed resolved/unresolved (→ count), empty threads (→ 0), GraphQL error (→ null), invalid URL (→ null)
- [x] Add `review: boolean` to `AgentParsedArgs` in `apps/agent/src/cli.ts` (default `false`); parse `--review` flag; pass it through to `RunListInput`
- [x] Add `--review` flag parsing test to `apps/agent/src/__tests__/cli.test.ts`
- [x] Add `review?: number` to `UnifiedRow` in `apps/agent/src/list.ts`; add `review = false` param to `fetchAndPrintLinear`; when `review = true`, call `fetchPrReviewSummary` in parallel for all rows with a `prUrl` and store result in `row.review`; render `Unresolved` column in the table
- [x] Add `Unresolved` column rendering tests to `apps/agent/src/__tests__/list-marker.test.ts` or a new `list-review.test.ts` (with flag off → no column; flag on + count → shows digit; flag on + no PR → dash)
- [x] Run `bun run lint` and fix any lint errors
- [x] Run `bun run test` and confirm all tests pass including refactored `scan.ts` tests
