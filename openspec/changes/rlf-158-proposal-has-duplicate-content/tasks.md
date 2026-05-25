# Tasks for RLF-158

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-158/proposal-has-duplicate-content and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Remove `{{ issue.description }}` line (and surrounding blank line) from the body of `DEFAULT_WORKFLOW_MD` in `packages/workflow/src/default.ts`
- [ ] Remove `{{ issue.description }}` line (and surrounding blank line) from the body section of `WORKFLOW.md`
- [ ] Add a test in `packages/workflow/src/__tests__/workflow.test.ts` verifying that rendering `DEFAULT_WORKFLOW_MD` with an issue description does NOT include the description in the output
- [ ] Run `bun run lint`
- [ ] Run `bun run test`
