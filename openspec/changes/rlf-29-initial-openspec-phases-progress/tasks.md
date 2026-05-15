# Tasks for RLF-29

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-29/initial-openspec-phases-progress and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [x] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Add `PhaseSegmentStatus`, `PhaseSegment`, and `phasePipeline(phase)` to `packages/core/src/openspec/phase.ts`; export ordered segments `proposal, design, tasks, implement` with `done`/`current`/`pending` statuses derived from the input phase (treat `done` as all-complete).
- [x] Extend `packages/core/src/__tests__/openspec-phase.test.ts` with `phasePipeline` cases for each of `proposal`, `design`, `tasks`, `implement`, and `done`, asserting the full segment array (phase, label, status).
- [x] In `apps/agent/src/components/AgentMode.tsx`, branch the header progress slot so that when `openspecPhase` is set and not `implement`, render an inline phase pipeline using `phasePipeline()` (glyphs `✓`/`●`/`○`, green for done, `openspecPhaseColor(phase)` bold for current, dim for pending, dim `─` separators) and skip the numeric bar; when `openspecPhase` is `implement`, keep the existing numeric `calcProgressBar` rendering unchanged.
- [x] Run `bun run lint` and fix any issues it reports.
- [x] Run `bun run test` and confirm the new phase-pipeline tests pass with no regressions and no coverage-threshold reduction.
- [x] Run `bunx openspec validate rlf-29-initial-openspec-phases-progress` and resolve any reported issues.
