# Tasks for RLF-195

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-195/model-the-ralph-loop-as-an-xstate-machine and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Create `packages/core/src/machines/loop.machine.ts` — define `loopMachine` using XState v5 `setup()` API with context type `LoopMachineContext`, event union `LoopMachineEvent`, all five guards, states `idle` / `checkingStop` / `running` / `stopped.*` (seven final sub-states), and assign actions for `ITERATION_DONE` and `ITERATION_FAILED`
- [x] Create `packages/core/src/machines/__tests__/loop.machine.test.ts` — write tests using `createActor` that cover all seven stop conditions (`maxIterations`, `completed`, `costCap`, `runtimeLimit`, `consecutiveFailures`, `rateLimited`, `stranded`) each reaching its correct final state; also test that consecutive-failure counter resets on `ITERATION_DONE` and that `maxIterations = 0` does not stop the loop
- [x] Edit `packages/core/src/machines/index.ts` — add `export { loopMachine } from "./loop.machine"`
- [x] Run `bun run lint` and fix any lint errors
- [x] Run `bun run test` and confirm all tests pass with no coverage threshold regression
