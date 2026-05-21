# Tasks for RLF-97

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-97/stage-8-split-implement-into-implement-awaiting-ci and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Extend `apps/agent/src/runtime/types.ts`: add `"awaiting-ci"` to the `FlowId` union and a new `awaitingCi: "none" | "watching"` field to `RouterSignals`.
- [x] Update `apps/agent/src/runtime/__tests__/router.property.test.ts` (or its property-test fixture) so the new field is part of the cross-product the totality test enumerates.
- [x] Add two new precedence rows to `apps/agent/src/runtime/router.ts` — `awaiting-ci pass` (idle catch-up) and `awaiting-ci watch` — placed just below `pr ci failing` and above `in-progress implement`.
- [x] Add row-level tests in `apps/agent/src/runtime/__tests__/router.test.ts` covering both new rows plus the precedence boundary against `pr ci failing` and `in-progress implement`.
- [x] Extend `apps/agent/src/features/types.ts`: add `"awaiting-ci"` to `FeatureId`; add a `transitioned` event shape (`{ to: FlowId }`) to the implement event surface.
- [x] Create `apps/agent/src/features/awaiting-ci/` slice (`index.ts`, `detect.ts`, `run.ts`, `events.ts`, `state.ts`) per design.md. `ownedSlot` is `null`; `run()` calls `caps.ciFix.getCiStatus()` exactly once and emits exactly one event.
- [x] Add `apps/agent/src/features/awaiting-ci/__tests__/run.test.ts` covering the four `getCiStatus()` outcomes (`pass`/`fail`/`pending`/`unknown`).
- [x] Register `awaitingCiFeature` in `apps/agent/src/features/registry.ts` and add its `REQUIREMENTS` row (needs `gh` and `ciFix`).
- [x] Extend `apps/agent/src/features/implement/postTask.ts` to write `state.pr.flow = "awaiting-ci"` and emit `feature.implement.transitioned` after a successful PR-URL write. Skip when `caps.implement` is unwired, the worker exited non-zero, or `getPrUrl()` returned `null`.
- [x] Extend `apps/agent/src/features/implement/__tests__/postTask.test.ts` to assert the new transition event and the `state.pr.flow` write, plus the skip cases.
- [x] Teach `apps/agent/src/runtime/flow-runner.ts` / `runtime/coordinator.ts` to dispatch `awaiting-ci` assignments through the slice's `run()` **without** acquiring a worker slot and without spawning a worker subprocess.
- [x] Add `apps/agent/src/runtime/__tests__/awaiting-ci-no-worker.test.ts` — a spy worker spawner MUST be called zero times across three consecutive polls of an `awaiting-ci` assignment, and `getCiStatus` MUST be called three times.
- [ ] Fold the legacy `runPrPhase` / `createPrWithRetry` paths in `apps/agent/src/agent/post-task.ts` into a new `caps.implement.pushAndOpenPr()` capability owned by the implement slice; delete the legacy branches and update `apps/agent/src/__tests__/post-task.test.ts` accordingly.
- [x] Extend the event-name preservation test (under `apps/agent/src/__tests__/`) to include `feature.awaiting-ci.completed`, `feature.awaiting-ci.failed`, and `feature.implement.transitioned`.
- [x] Refresh the `--json-output` golden fixture so the new `awaiting-ci` flow id is enumerated; verify no existing field is removed.
- [x] Run `bun run lint` and fix any reported issues.
- [x] Run `bun run test` and ensure the suite is green; coverage threshold MUST NOT be lowered.
- [x] Run `bunx openspec validate rlf-97-stage-8-split-implement-into-implement-a --strict` and resolve any reported issues.
- [ ] Stage and commit each touched file individually (no `git add -A`, no `git commit -am`).
- [ ] Push the branch and open the PR per the change instructions.
