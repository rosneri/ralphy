# Tasks for RLF-167

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-167/review-step-model and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] `packages/workflow/src/default.ts` — Add commented `openspec.reviewPhase` section to `DEFAULT_WORKFLOW_MD` documenting `reviewerModel`, `maxRounds`, `enabled`, and `reviewerContextStrategy`
- [x] `apps/loop/src/cli.ts` — Add `ReviewPhaseArgs` interface and `reviewPhase` field to `ParsedArgs`; parse `--review-enabled`, `--review-model`, `--review-max-rounds`, `--review-context-strategy` flags in `parseArgs()`
- [x] `apps/loop/src/components/App.tsx` — Spread `args.reviewPhase` into `LoopOptions` in `TaskModeWrapper` when `args.reviewPhase.enabled` is true
- [x] `apps/agent/src/agent/wire/spawn/worker.ts` — Read `cfg.openspec.reviewPhase` in `buildTaskCmdFor` and append the corresponding CLI flags
- [x] `apps/loop/src/__tests__/cli.test.ts` — Add review-phase tests: default disabled, `--review-enabled`, `--review-model` implies enabled, `--review-max-rounds`, `--review-context-strategy`, invalid strategy throws
- [x] `apps/agent/src/__tests__/wire-setup-worktree.test.ts` — Add `describe("spawnWorker — review phase CLI flags")` with three tests: `enabled:true`, full config, `enabled:false`
- [x] `apps/loop/src/__tests__/App-misc.test.tsx`, `App-task.test.tsx`, `components.test.tsx` — Add `reviewPhase` default to `makeArgs` helper to satisfy updated `ParsedArgs` type
- [x] `bun run lint` — verify no new lint errors
- [x] `bun test apps/loop/src/__tests__/cli.test.ts apps/loop/src/__tests__/App-misc.test.tsx apps/loop/src/__tests__/App-task.test.tsx apps/loop/src/__tests__/components.test.tsx apps/agent/src/__tests__/wire-setup-worktree.test.ts` — all tests pass
