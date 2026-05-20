# Tasks for RLF-78

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-78/confirmation-mode-human-gate-between-tasks-and-implement and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Phase A — schema + deriver (PR 1)

- [x] Extend `OpenSpecPhase` in `packages/core/src/openspec/phase.ts` with `"awaiting-confirmation"`; add `confirmationGated` and `approved` to `OpenSpecPhaseInputs`; insert the new branch into `deriveOpenSpecPhase` after the `tasks` check and before the `implement` check; add `awaiting-confirmation` to `PIPELINE_PHASES` between `tasks` and `implement`.
- [x] Add unit tests in `packages/core/src/__tests__/openspec-phase.test.ts` covering: (a) gated + no approval → `awaiting-confirmation`, (b) gated + approval → `implement`, (c) ungated → `implement` (no regression), (d) gated + all-checked → `done` (terminal still wins), (e) `PIPELINE_PHASES` order.
- [x] Add `confirmation` slot to `StateSchema` in `packages/types/src/types.ts` with `askedAt`, `lastReminderAt`, `confirmedAt`, `rounds` fields, all defaulting safely. Add tests proving defaults and that old persisted state without the slot still parses.

### Phase B — workflow config + indicators (PR 2)

- [x] Extend `WorkflowConfigSchema` in `packages/workflow/src/schema.ts` with `linear.confirmationMode` (`enabled`, `optOutLabel`, `timeoutHours`, `maxConfirmationRounds`) and the optional `getApproved` / `clearApproved` indicators (reuse the existing `Marker`/`Indicator` shapes).
- [x] Wire deriver inputs: in the place where `OpenSpecPhaseInputs` is constructed per ticket, compute `confirmationGated = confirmationMode.enabled && !ticketHasLabel(optOutLabel)` and `approved = matchesIndicator(getApproved)`.
- [x] Add schema tests covering defaults, the opt-out path, and the indicator wiring.

### Phase C — coordinator + agent behaviour (PR 3)

- [x] Extend `PollBuckets` in `apps/agent/src/agent/coordinator.ts` with `awaiting: number`. Route `awaiting-confirmation` tickets into that bucket. Ensure they are excluded from `getInProgress` results and never consume `concurrency` slots.
- [x] In `apps/agent/src/agent/wire.ts`, on the transition into `awaiting-confirmation` post a one-shot "📋 Ralphy plan ready" Linear comment, idempotent via `state.confirmation.askedAt`. Persist `askedAt = now`.
- [x] In the coordinator's per-poll inspection of `awaiting` tickets: detect `getApproved` matches → fire `clearApproved`, set `confirmedAt`; detect `@ralphy revise: <reason>` comments → consume, write to steering, bump `rounds`, reset `confirmedAt`, loop back to `design`; honour `timeoutHours` reminder cadence; honour `maxConfirmationRounds` cap (post stuck comment, apply `ralph:stuck` label, skip on further polls).
- [x] Suppress `createPrOnSuccess` for any change in `awaiting-confirmation`. Keep `syncTasksToComment` and `syncSpecsAsAttachments` running.
- [x] Reap any in-flight worker the moment a ticket flips to `awaiting-confirmation` (revise mid-implement edge case).
- [x] Add coordinator tests: `concurrency=1` + one gated ticket + one fresh Todo ticket → the fresh ticket runs; gated ticket never appears in `workers.active`/`workers.queue`. Add tests for the approval, revise, reminder, and round-cap paths.

### Phase D — UI surface (still PR 3 or split as PR 3b)

- [ ] Ink TUI: render `[GATE]  Awaiting confirmation  ·  round N  ·  asked Xm ago` on change-cards in the new phase; add the `awaiting-confirmation` segment to the phase-pipeline renderer; add `awaiting N` to the poll-status block.
- [ ] `apps/agent/src/agent/json-runner.ts`: add `buckets.awaiting` to every `poll_done` payload; emit a one-shot `{"type":"awaiting_confirmation","changeName":"...","since":"...","round":N}` event per round entry (idempotent via a `lastEmittedRound` sentinel).
- [ ] Add tests/snapshots for the TUI rendering and the JSON event shape.

### Phase E — docs + template (PR 4)

- [ ] Add a commented-out `confirmationMode` block (with the `getApproved` / `clearApproved` indicators) to `packages/workflow/src/default.ts`.
- [ ] Add a short README section showing the three signals (approve label, `@ralphy revise:` comment, opt-out label) and pointing at the new config keys.
- [ ] Update `WORKFLOW.md` if it documents indicators.

### Cross-cutting verification

- [ ] Run `bunx openspec validate rlf-78-confirmation-mode-human-gate-between-tas` and confirm it passes.
- [ ] Run `bun run lint` and fix any new issues.
- [ ] Run `bun run test` and confirm the suite is green; coverage threshold is NOT reduced.
- [ ] Manually smoke-test via the `manual-test` skill on a sample Linear project: ticket gets gated, approval label advances it, revise comment loops back to design, opt-out label bypasses.
