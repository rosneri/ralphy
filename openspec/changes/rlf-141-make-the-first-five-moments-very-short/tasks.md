# Tasks for RLF-141

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-141/make-the-first-five-moments-very-short and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Modify `buildTaskPrompt` in `packages/core/src/loop.ts` to inject a "Verbosity: VERY SHORT" block when `state.iteration < 5`
- [x] Add tests in `packages/core/src/__tests__/loop.test.ts` covering moments 1, 5, and 6 (boundary conditions) and verbosity block ordering
- [x] Run `bun run lint` and confirm 0 errors (warnings pre-exist and are unrelated)
- [x] Run `bun test packages/core/src/__tests__/loop.test.ts` and confirm all 38 tests pass
