# Tasks for RLF-151

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-151/support-no-pr-tasks-with-validate-only-flow and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `validateOnComplete: z.boolean().default(false)` to `WorkflowConfigSchema` in `packages/workflow/src/schema.ts`
- [x] Add `validateOnComplete: z.boolean().default(false)` to `StateSchema` in `packages/types/src/types.ts`
- [x] Add `validateOnComplete?: boolean` to `BuildInitialStateOptions` and pass it through in `buildInitialState` in `packages/core/src/state.ts`
- [x] Add `validateOnComplete?: boolean` to `LoopOptions` in `packages/core/src/loop.ts`; update `buildTaskPrompt` to omit `bunx openspec validate` and PR instructions when `state.validateOnComplete && !state.createPr`
- [x] Add `--validate-on-complete` flag to loop CLI in `apps/loop/src/cli.ts`; add `validateOnComplete: boolean` to `ParsedArgs`
- [x] Update `apps/loop/src/components/App.tsx`: pass `validateOnComplete: args.validateOnComplete` and change `createPr: args.fromAgent && !args.validateOnComplete`
- [x] Update `apps/loop/src/hooks/useLoop.ts`: pass `validateOnComplete` to `buildInitialState`; skip `getStatus()` check when `currentState.validateOnComplete && !currentState.createPr`
- [x] Add `"validate"` and `"validate-fix"` to `PostTaskPhase`; add `wantValidateOnly?: boolean` to `PostTaskInput`; add `validateCommands?: string[]` to `PostTaskInput.cfg`; add exported `runValidateOnlyPhase`; update `runPostTask` to call it when `wantValidateOnly && exitCode === 0` — all in `apps/agent/src/agent/post-task.ts`
- [x] In `apps/agent/src/agent/wire/spawn/worker.ts`: derive `wantValidateOnly = cfg.validateOnComplete && !wantPrBase`; add `--validate-on-complete` to `buildTaskCmdFor` output when `wantValidateOnly`; add `validateCommands` to `cfg` from `[cfg.commands.test, cfg.commands.lint, cfg.commands.typecheck].filter(Boolean)`
- [x] Write tests for `runValidateOnlyPhase` in `apps/agent/src/__tests__/post-task-validate-only.test.ts` covering: checks pass → validation task injected; first check fails → fix task injected; no commands → straight to validation
- [x] Update `packages/core/src/__tests__/loop.test.ts` to cover `buildTaskPrompt` with `validateOnComplete=true, createPr=false` (openspec-validate and PR instructions absent)
- [x] Run `bun run lint && bun run test` and fix any issues
