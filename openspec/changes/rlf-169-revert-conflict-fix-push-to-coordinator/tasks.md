# Tasks for RLF-169

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-169/revert-conflict-fix-push-to-coordinator-post-task-consistency and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Remove the `mode === "conflict-fix"` short-circuit (lines 1102–1163) from `runPostTask` in `apps/agent/src/agent/post-task.ts`
- [x] Add `clearConflicted` call in `runPostTask` after `runPrPhase` for conflict-fix mode (outside `wantPr` gate to match old short-circuit behavior)
- [x] Remove unused `fetchPrStatus` import from `post-task.ts` and update the `clearConflicted` JSDoc comment
- [x] Strip `git push --force-with-lease` and push-rejection guidance from conflict-fix task body in `apps/agent/src/agent/wire/prepare.ts::prepareTaskForTrigger`
- [x] Delete `apps/agent/src/features/conflict-fix/postTask.ts` (now a dead no-op)
- [x] Update `apps/agent/src/features/conflict-fix/index.ts`: remove `postTask` field and import, update JSDoc
- [x] Delete `apps/agent/src/features/conflict-fix/__tests__/postTask.test.ts`
- [x] Rewrite `apps/agent/src/__tests__/post-task-conflict-fix.test.ts` to test the new flow (git push called, clearConflicted called on success)
- [x] Update `apps/agent/src/__tests__/post-task-feature-registry.test.ts` to remove conflict-fix feature events from expected list
- [x] Update coordinator comment at lines 1217-1220 in `apps/agent/src/runtime/coordinator.ts`
- [x] `bun run lint` — 0 errors
- [x] `bun test apps/agent/src/__tests__/post-task-conflict-fix.test.ts` — green
- [x] `bun test apps/agent/src/__tests__/coordinator.test.ts` — green
- [x] `bun test apps/agent/src/__tests__/agent-characterization.test.ts` — green
- [x] `bun test apps/agent/src/__tests__/agent-integration.test.ts` — green
