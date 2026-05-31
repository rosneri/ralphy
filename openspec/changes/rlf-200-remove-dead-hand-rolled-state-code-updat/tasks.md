# Tasks for RLF-200

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-200/remove-dead-hand-rolled-state-code-update-docs and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)

## Implementation

- [x] In `apps/agent/src/runtime/coordinator.ts`, replace the `resumeTrigger` actor-snapshot derivation (~lines 480-495) with a direct `"resume"` literal
- [x] In `apps/agent/src/runtime/coordinator.ts`, replace the `trigger` actor-snapshot derivation in `maybePromoteFinishedConflicted` (~lines 698-706) with a direct ternary on `pr.status`
- [x] In `apps/agent/src/runtime/coordinator.ts`, remove the dead `else` fallback branch in `reportProgress` flow-state computation (~lines 586-592) that falls back from actor state to trigger string; add defensive warning log instead
- [x] Audit `packages/core/src/loop.ts` for imperative stop-condition guards duplicated by `loop.machine.ts` and remove any dead wrappers; preserve all prompt-building helpers
- [x] Add a `## State Machines` section to `CLAUDE.md` documenting `flow.machine.ts`, `loop.machine.ts`, and `flow-actor-store.ts`
- [x] Run `bun run build:architecture` to regenerate `ARCHITECTURE.md` and verify `git diff --exit-code ARCHITECTURE.md` passes
- [x] Run `bun run lint` (knip + fmt) and fix any newly-unused exports or format errors
- [x] Run `bun test` and confirm the full test suite is green; update any coordinator test assertions that break due to the trigger-derivation removal
