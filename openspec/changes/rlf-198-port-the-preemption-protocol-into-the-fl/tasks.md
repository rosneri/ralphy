# Tasks for RLF-198

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-198/port-the-preemption-protocol-into-the-flow-machine and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [ ] Add `specs/flow-machine-preemption/spec.md` describing the `preempting` state behavior, event contracts, and no-worker path
- [ ] Add `FlowContext` type and `FlowInput` type to `packages/core/src/machines/flow.machine.ts` with fields: `issueId`, `bus`, `persist`, `graceMs`, `worker`, `teardown`, `currentAssignment`, `pendingAssignment`
- [ ] Add `PREEMPT` and `WORKER_SPAWNED` event types to `flowMachine`'s `FlowEvent` union
- [ ] Declare `preemption` actor slot in `setup({ actors: { preemption: ... } })` using `fromPromise` with the correct `PreemptActorInput` type
- [ ] Add `preempting` state to `flowMachine` with `invoke: { src: "preemption", input: ..., onDone: ..., onError: "error" }` and clear `worker`/`teardown` on done
- [ ] Add `PREEMPT` transition from `working`, `conflict-fix`, and `ci-fix` states (assigns `pendingAssignment`, enters `preempting`)
- [ ] Add `PREEMPT` transition from `awaiting` state (same `preempting` state; `worker` will be `undefined` triggering the no-worker path)
- [ ] Add `WORKER_SPAWNED` assign action on all worker-bearing states to update `context.worker`, `context.teardown`, and `context.currentAssignment`
- [ ] Implement post-preemption routing: after `preempting.onDone`, guard-target to the correct state based on `context.pendingAssignment.flowId`
- [ ] Extract `preemptionActorLogic` (`fromPromise`) from the existing `preempt()` body in `apps/agent/src/runtime/flow-runner.ts`; branch on `input.worker === undefined` for the no-worker path
- [ ] Update `FlowActorStore` to accept `FlowActorDeps` (issueId, bus, persist, graceMs) at construction and pass them as `input` to `createActor`; use `flowMachine.provide({ actors: { preemption: preemptionActorLogic } })`
- [ ] Update coordinator: send `WORKER_SPAWNED` event (with worker handle, teardown, assignment) after spawning a subprocess
- [ ] Update coordinator: send `PREEMPT` event (with `newAssignment`) when a flow change is needed while a worker is active, replacing any future call to `preempt()`
- [ ] Port the 4 existing `flow-runner-preempt.test.ts` tests to `packages/core/src/machines/__tests__/flow.machine-preempt.test.ts` driving the machine directly with fake workers and injected `graceMs`
- [ ] Add machine-level test: `awaiting` → `PREEMPT` → machine exits `preempting` without calling `kill()`
- [ ] Add machine-level tests for post-preemption routing: verify `machine.getSnapshot().value` for each `pendingAssignment.flowId`
- [ ] Add machine-level test: snapshot rehydration mid-`preempting` with undefined worker resolves via no-worker path
- [ ] `bun run lint` passes across all affected packages
- [ ] `bun run test` passes across all affected packages
