# Tasks for RLF-177

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-177/research-and-implement-proper-task-breakdown-methodology and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Update `packages/content/phases/plan.md`: replace Step 4 (Create PROGRESS.md) with the 6-step atomic decomposition algorithm (inventory → atomic expansion → caller enumeration → TDD pairing → dependency ordering → completeness audit); add anti-patterns section; remove "3-8 items" as primary sizing heuristic
- [x] Create `packages/content/checklists/task-completeness.md` with a completeness audit checklist covering: types/schemas, implementation, callers, test coverage, and static analysis
- [x] Update `packages/content/scaffolds/PROGRESS.md` to show atomic item format with TDD pairs and explicit file-path references
- [x] Update `packages/content/scaffolds/PLAN.md` to add a `## Traceability` section
- [x] Run `bun run lint` and confirm zero errors
- [x] Run `bun run test` and confirm all tests pass
