# Tasks for RLF-156

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-156/agent-mode-max-iterations-dont-work and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Fix `apps/loop/src/hooks/useLoop.ts`: capture `startingIteration = currentState.iteration` before the loop and pass `startingIteration + iter` to both `checkStopCondition` calls
- [x] Add test to `apps/loop/src/hooks/__tests__/useLoop.test.ts` verifying `startingIteration` is used
- [x] Run `bunx nx run loop:test` — all tests pass
- [x] Run `bun run lint` — no errors
