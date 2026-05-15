# Tasks for RLF-43

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-43/openspec-flow and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [x] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] In `packages/core/src/openspec/phase.ts`, add pure predicates `shouldShowPhasePipeline(phase)`, `shouldShowSubtasksPanel(phase, showPendingTasks, hasSubtasks)`, and `shouldShowProgressBar(phase, showPendingTasks, hasProgress)` that encode the phase-gating matrix from `design.md`.
- [x] Add unit tests in `packages/core/src/openspec/__tests__/phase.test.ts` (or the existing phase test file) covering every row of the matrix for each predicate, including the `undefined` (non-OpenSpec) and `done` cases.
- [x] Update `apps/agent/src/components/AgentMode.tsx` to import the new predicates and use them as the JSX render guards for the phase pipeline, SUBTASKS panel, and bottom progress bar blocks.
- [x] In `apps/agent/src/components/AgentMode.tsx`, move the phase-pipeline JSX block so it renders **before** the SUBTASKS panel block and **before** the steering-input block (immediately after the OUTPUT tail).
- [x] Verify visually via `bun run manual-test` (or the project's manual-test skill) that a worker in `design` phase shows the pipeline above the steering input and no SUBTASKS panel; a worker in `implement` phase shows the SUBTASKS panel as before.
- [x] Run `bunx openspec validate rlf-43-openspec-flow` and resolve any validation errors.
- [x] Run `bun run lint` and fix any reported issues.
- [x] Run `bun run test` and ensure all tests (new and existing) pass.
