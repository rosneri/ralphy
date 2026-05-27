# Tasks for RLF-110

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-110/integration-tests-state-store-openspec-lifecycle-s51-s55-s91-s97 and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Fix `listChanges` in `packages/openspec/src/openspec-change-store.ts`: remove the `Bun.file(changesDir).exists()` guard (returns false for directories; the `try/catch` around `readdir` already handles missing directories)
- [x] Write S5.1–S5.5 integration tests in `packages/core/src/__tests__/state-store-integration.test.ts` covering ownership isolation, schema-drift tolerance, corruption recovery, external mutation, and all-slot accumulation
- [x] Write S9.1–S9.7 integration tests in `packages/openspec/src/__tests__/openspec-lifecycle-integration.test.ts` covering missing dir, empty files, stub round-trips, unicode names, prefix collisions, directory auto-creation, and archive exclusion
- [x] Run `bun run lint` and confirm no new errors
- [x] Run `bun test packages/core/src/__tests__/` and confirm all 289+ tests pass
- [x] Run `bun test packages/openspec/src/__tests__/` and confirm all 41+ tests pass
