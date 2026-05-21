# Tasks for RLF-94

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-94/stage-5-migrate-features-vertically and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Scaffolding (shared by all slices)

- [x] Create `apps/agent/src/features/types.ts` with the `Feature`, `FeatureCtx`, `FeatureMatch`, and `FeatureId` types described in design.md
- [x] Create `apps/agent/src/features/run-feature.ts` that wraps `detect`/`run` in try/catch, emits `feature.<id>.{detected,started,completed,failed,skipped}` on the bus, and never lets one feature throw block the registry walk
- [x] Create `apps/agent/src/features/registry.ts` exporting the ordered list `[confirmation, conflict-fix, ci-fix, implement, review-followup, new-ticket, mention, stuck]`; until each slice ships, the registry MAY hold adapters that delegate to the existing `coordinator.ts` branches so the dispatch path is exercised end-to-end from day one
- [x] Extend `packages/events/src/types.ts` `RalphEvent` union with `feature.<id>.{detected,started,completed,failed,skipped}` literals for each of the 8 features and add tests asserting the bus accepts them
- [x] Add a boundary test under `apps/agent/src/__tests__/feature-boundaries.test.ts` that fails if any `features/<a>/**` file imports from `features/<b>/**` (a !== b), except via `features/types.ts` / `features/run-feature.ts`
- [x] Rewire `apps/agent/src/agent/coordinator.ts` to iterate the registry for in-progress issues (still falling through to legacy branches for unmigrated features via the registry adapters)
- [x] Rewire `apps/agent/src/agent/post-task.ts` to iterate the registry and call `feature.postTask?.(...)` (legacy branches stay only for not-yet-migrated features and route through the registry adapter)

### Per-feature vertical slices (in merge order)

- [x] `features/confirmation/`: detect (gate, revise, roundsExhausted), run (plan-ready, reminder, react), state (`confirmation` slot), events, `__tests__/`; delete `apps/agent/src/agent/confirmation/`; drop `classifyAwaitingConfirmation` dep from `coordinator.ts`
- [x] `features/conflict-fix/`: `postTask` only verifies mergeability via the `getMergeability` capability (push lives inside the AI iteration per RLF-82); remove the conflict-fix arm from `coordinator.ts` / `post-task.ts`; tests cover the mergeability-only postTask
- [ ] `features/ci-fix/`: owns `state.ci` writes; detect + run + postTask + tests; remove ci-fix arm from `coordinator.ts` / `post-task.ts`
- [ ] `features/implement/`: keeps the push + hook-fix retry in its `postTask`; owns `state.pr.url` and `state.pr.openedAt`; remove implement arm from `coordinator.ts` / `post-task.ts`; tests cover push retry behavior
- [ ] `features/review-followup/`: owns the `review.lastConsumedCommentAt` watermark introduced in Stage 3; remove the review-followup arm from `coordinator.ts`; tests cover watermark advance + skip-when-unchanged
- [ ] `features/new-ticket/`: detect + run + tests; remove the new-ticket arm from `coordinator.ts`
- [ ] `features/mention/`: produces `feature.mention.reviseComment` and other mention signals; MUST NOT write the `confirmation` slot directly; remove the mention arm from `coordinator.ts`; tests assert no `state.confirmation` writes via the boundary test plus a unit test
- [ ] `features/stuck/`: detect + run + tests; remove the stuck arm from `coordinator.ts`

### Cleanup & verification

- [ ] After all 8 slices ship, delete remaining feature-specific dead code from `coordinator.ts` and `post-task.ts` so they only own dispatch + shared pre/post hooks
- [ ] Confirm `apps/agent/src/agent/confirmation/` no longer exists
- [ ] Run `bunx openspec validate rlf-94-stage-5-migrate-features-vertically` — must pass
- [ ] Run `bun run lint` from repo root — must pass
- [ ] Run `bun run test` from repo root — must pass, coverage threshold unchanged
- [ ] Manually verify the agent still polls, picks features, and runs end-to-end (Stage 0 characterization tests stay green throughout)
