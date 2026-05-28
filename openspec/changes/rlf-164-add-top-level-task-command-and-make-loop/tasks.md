# Tasks for RLF-164

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-164/add-top-level-task-command-and-make-loop-orchestrate-phases and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Add `TaskPhase` type and `buildPhasePrompt` router to `packages/core/src/loop.ts`: rename `buildTaskPrompt` → `buildExecutePrompt`, add `buildResearchPrompt`, `buildPlanPrompt`, `buildReviewPrompt`, add `buildPhasePrompt(phase, state, taskDir, reviewPhase?)`, keep `buildTaskPrompt` as alias
- [x] Add `phase?: TaskPhase` to `LoopOptions` in `packages/core/src/loop.ts` and update `useLoop.ts` to call `buildPhasePrompt(opts.phase ?? "execute", ...)` instead of `buildTaskPrompt`
- [x] Update `apps/loop/src/loop.ts` re-exports to include new exports: `TaskPhase`, `buildPhasePrompt`, `buildExecutePrompt`, `buildResearchPrompt`, `buildPlanPrompt`, `buildReviewPrompt`
- [x] Create `apps/loop/src/task-cli.ts` with `TaskParsedArgs`, `parseTaskArgs`, and `printTaskHelp`
- [x] Export `taskMain(argv)` from `apps/loop/src/index.ts` that parses args, creates state/tasks dirs, and renders the App with `taskPhase` set
- [x] Update `apps/loop/src/components/App.tsx` to accept and forward `taskPhase?: TaskPhase` through `AppProps` → `TaskModeWrapper` → `TaskLoop` → `LoopOptions`
- [x] Update `apps/shell/src/index.ts`: add `"task"` to `SUBCOMMANDS`, dispatch to `taskMain`, update `HELP` text
- [x] Write unit tests for `buildPhasePrompt` routing in `packages/core/src/__tests__/loop.test.ts` (or similar); verify each phase routes to the correct builder and `buildTaskPrompt` alias still works
- [x] Write unit tests for `parseTaskArgs` in `apps/loop/src/__tests__/task-cli.test.ts`: valid phases, missing phase error, unknown phase error, all common flags parsed correctly
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and fix any failures
