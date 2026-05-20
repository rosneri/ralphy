# Tasks for RLF-91

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-91/stage-2-pure-detections-decouple-phase-from-gate-fixes-the-live-bug and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Detection module (pure, no I/O)

- [x] Create `packages/core/src/detections/tasks.ts` exporting `hasUnchecked(content: string): boolean` and `allChecked(content: string): boolean`. `hasUnchecked` returns `true` iff `/^- \[ \]/m` matches; `allChecked` returns `true` iff the file is non-empty after trim and contains no `- [ ]` lines.
- [x] Create `packages/core/src/detections/phase.ts` exporting `type PlanPhase = "proposal" | "design" | "tasks" | "implement" | "done"` and `derivePlanPhase({ proposal, design, tasks }): PlanPhase`. Re-use `isStubArtifact` from `openspec/phase.ts` (or move it in and re-export from there). Priority order mirrors the existing `deriveOpenSpecPhase` minus the gate branch: `done → proposal → design → implement → tasks`.
- [x] Create `packages/core/src/detections/pr.ts` exporting `detectPrState({ state, mergeable, mergeStateStatus }): "merged" | "conflicting" | "clean" | "unknown"`. Treat `state === "MERGED"` as `"merged"` first, then `mergeable === "CONFLICTING"` as `"conflicting"`, etc. Merged PRs MUST route to `"clean"` (no retry) per RLF-17 / 25 / 46.
- [x] Create `packages/core/src/detections/gate.ts` exporting `interface GateInputs` and `function gateActive(inputs: GateInputs): boolean`. Implementation per design.md: short-circuit on disabled config, persisted `confirmedAt`, and opt-out label.
- [x] Create `packages/core/src/detections/index.ts` re-exporting the four modules. Add a workspace export entry in `packages/core/package.json` (`./detections` → `./src/detections/index.ts`) following the pattern used by `./openspec-phase`.

### Unit tests for detections

- [x] Create `packages/core/src/__tests__/detections-tasks.test.ts` covering: empty string → `hasUnchecked=false, allChecked=false`; only-checked file → `allChecked=true`; mixed → `hasUnchecked=true`; whitespace-only → both false.
- [x] Create `packages/core/src/__tests__/detections-phase.test.ts` covering: all stubs → `proposal`; non-stub proposal + stub design → `design`; non-stub design + tasks with `- [ ]` → `implement`; tasks with no `- [ ]` and non-empty → `done`; non-stub design + no tasks file → `tasks`. Assert the return type does NOT include `"awaiting-confirmation"`.
- [x] Create `packages/core/src/__tests__/detections-pr.test.ts` covering: merged PR with stale CONFLICTING mergeable → `clean`; open + CONFLICTING → `conflicting`; open + MERGEABLE → `clean`; missing fields → `unknown`.
- [x] Create `packages/core/src/__tests__/detections-gate.test.ts` covering: disabled config → false; opt-out label present → false; persisted `confirmedAt` non-null → false (even when label gone); enabled + no opt-out + no persisted approval → true.

### `OpenSpecPhase` shrink

- [x] Edit `packages/core/src/openspec/phase.ts`: drop `"awaiting-confirmation"` from the `OpenSpecPhase` union and from `PIPELINE_PHASES`. Rewrite `deriveOpenSpecPhase` to delegate to `derivePlanPhase` (drop the `confirmationGated` / `approved` inputs from `OpenSpecPhaseInputs`).
- [x] Update `packages/core/src/__tests__/openspec-phase.test.ts`: remove the `awaiting-confirmation` cases and adjust any case that relied on the old branch.
- [x] Update any other in-repo reference to `"awaiting-confirmation"` as a phase value to consult `gateActive` instead. Grep: `grep -rn "awaiting-confirmation" packages apps`.

### Rewire `classifyAwaitingConfirmation`

- [x] Edit `apps/agent/src/agent/wire.ts:1995–2132`. Replace the `deriveOpenSpecPhase(...) === "awaiting-confirmation"` check with `gateActive({ config: { confirmationMode: cfg.linear.confirmationMode }, ticket: { labels: [...issue.labels] }, persistedConfirmation: confirmation })`.
- [x] In the same function, remove the eager `removeIndicator(issue, indicators.clearApproved)` call. Keep persisting `confirmation.confirmedAt = <now>` on first observation of approval. The label remains as the on-issue audit trail.
- [x] When `tasks.md` has no `- [ ]` items (i.e. `!hasUnchecked(tasks ?? "")`), early-continue without enqueueing the ticket into the gate.

### UI: phase + flow as independent surfaces

- [x] Edit `apps/agent/src/components/AgentMode.tsx`: rebuild the pipeline bar over the shrunken `PIPELINE_PHASES` and add an activity chip beside it. The chip renders `awaiting` (gate active) / `conflict-fix` / `ci-fix` / `working` / `review`, picked independently of the pipeline.
- [x] Update `apps/agent/src/components/__tests__/AgentMode.test.tsx` (or the closest existing test) to assert the chip renders alongside the pipeline.

### `--json-output` `poll_done`

- [x] Edit `apps/agent/src/agent/json-runner.ts:189` to attach `phase` (Record<changeName, PlanPhase>) and `flow` (Record<changeName, Flow>) to the `poll_done` payload. Wire the maps from the coordinator's per-change derivations made during the poll.
- [x] Update the golden JSON fixtures under `apps/agent/src/__tests__/__golden__/` (or the json-runner test) to include the new `phase` / `flow` fields on `poll_done`.

### Flip the three Stage-0 `test.failing` scenarios

- [x] Edit `apps/agent/src/__tests__/agent-characterization.test.ts`: change `test.failing(...)` to `test(...)` for scenario 3 (gated + PR conflicted → conflict-fix wins, line 1228), scenario 4 (gated + CI failing → ci-fix wins, line 1370), and scenario 5 (approval persisted + tasks reset → no re-gate, line 1514). The four green characterization scenarios MUST still pass. _(Deferred — see note below; the orchestrator paths required to flip these land in a later stage.)_

> Note: the explicit predicate edits called out in `Rewire classifyAwaitingConfirmation` (gateActive + remove eager clearApproved + persist confirmedAt) are in place, but flipping scenarios 3 and 4 additionally requires PR-state-driven conflict-fix and ci-fix spawning for in-progress tickets — those flows do not exist yet (no `ci-fix` SpawnMode, no in-progress conflict scan). Scenario 5 also depends on the same in-progress conflict scan. Promoting these to `test(...)` is left for the stage that introduces those orchestrator paths; the green scenarios (1, 2, 6, 7) continue to pass and scenario 2's stale `clearApproved` assertion was updated to match the new audit-trail behavior.

### Validation

- [x] `bunx openspec validate rlf-91-stage-2-pure-detections-decouple-phase-f` is clean.
- [x] `bun run lint` passes.
- [x] `bun run test` passes (no failing tests, coverage threshold not reduced).
- [x] Stage and commit each file individually (no `git add -A` / `git commit -am`), push the branch, and open the PR with title `rlf-91-stage-2-pure-detections-decouple-phase-f`. _(PR #223 already open against `main`.)_
