# Tasks for RLF-196

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-196/cut-over-coordinator-to-the-flow-machine-interpret-persistence and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### 1. State schema & types

- [x] Add `coordinator: ["flow"]` to `OWNERSHIP` in `packages/core/src/state/schema.ts`
- [x] Add `"flow"` to `StateSlotName` union in `apps/agent/src/features/types.ts`

### 2. Flow machine definition

- [x] Create `packages/core/src/machines/flow.machine.ts` with the `flowMachine` XState v5 machine covering all states (`idle`, `working`, `conflict-fix`, `ci-fix`, `awaiting`, `review`, `done`, `error`) and all events (`FRESH_PICKED_UP`, `RESUME_DETECTED`, `REVIEW_TRIGGERED`, `AWAITING_DETECTED`, `CONFLICT_DETECTED`, `CI_FAILED_DETECTED`, `CONFIRMATION_CLEARED`, `WORKER_SUCCEEDED`, `WORKER_FAILED`)
- [x] Export `flowMachine` from `packages/core/src/machines/index.ts`
- [x] Write `packages/core/src/machines/__tests__/flow.machine.test.ts` covering every declared transition (idle → working via each entry event, working → conflict-fix/ci-fix/awaiting/review, each fix state → working on success, terminal states, ignoring irrelevant events)
- [x] Run `bun run test packages/core` — flow machine tests pass

### 3. FlowActorStore

- [x] Create `packages/core/src/machines/flow-actor-store.ts` with a `FlowActorStore` class that: (a) holds a `Map<string, Actor>` keyed by changeName; (b) `getActor(changeName, changeDir)` loads the snapshot via `Bun.file`, rehydrates on hit, creates fresh actor in `idle` on miss or parse error; (c) `persistActor(changeName, changeDir)` calls `writeField(changeDir, "coordinator", "flow.actorSnapshot", actor.getPersistedSnapshot())`; (d) `disposeActor(changeName)` stops and removes from map
- [x] Export `FlowActorStore` from `packages/core/src/machines/index.ts`
- [x] Write `packages/core/src/machines/__tests__/flow-actor-store.test.ts` covering: fresh actor (no file), snapshot persist → fresh store → rehydrate gives same state, corrupt snapshot file falls back to idle, `disposeActor` removes from map
- [x] Run `bun run test packages/core` — actor store tests pass

### 4. Coordinator cut-over

- [x] Instantiate `FlowActorStore` in `AgentCoordinator` constructor
- [x] In `walkRegistryForInProgress`: after the confirmation feature claims an issue, send `AWAITING_DETECTED` to its actor; when the feature no longer claims the issue (gate cleared), send `CONFIRMATION_CLEARED`; persist after each dispatch
- [x] In `maybePromoteFinishedConflicted`: replace the return-trigger logic with actor dispatch (`CONFLICT_DETECTED` / `CI_FAILED_DETECTED`) and derive the queue trigger from `actor.getSnapshot().value`; persist after dispatch
- [x] In `pollOnce` (in-progress loop): send `RESUME_DETECTED` to the actor before queuing; derive trigger from actor state
- [x] In `pollOnce` (todo loop): send `FRESH_PICKED_UP` to the actor; derive trigger from actor state
- [x] In `pollOnce` (mention loop): send `REVIEW_TRIGGERED` to the actor; derive trigger from actor state
- [x] In `notifyExited`: send `WORKER_SUCCEEDED` or `WORKER_FAILED` based on exit code; persist; call `disposeActor` when actor reaches a terminal state (`done` / `error`)
- [x] Replace the `flow` derivation block (currently reads `w.trigger`) with a read of `actor.getSnapshot().value` cast to the `Flow` type

### 5. Tests

- [x] Update `apps/agent/src/__tests__/coordinator.test.ts` to verify that queue triggers are derived from actor state (check that `flow` values in `PollResult` reflect machine states, not raw `w.trigger`)
- [x] Add a coordinator integration test that simulates a process restart: persist snapshot mid-flow, create a new coordinator instance, verify the actor rehydrates to the correct state and the same trigger is produced
- [x] Run `bun run test apps/agent` — all coordinator tests pass, `feature-boundaries.test.ts` unchanged
- [x] Run `bun run lint` — no errors

### 6. Final validation

- [x] Run `bun run test` (full suite) — no regressions
- [x] Run `bun run lint` — clean
