# Tasks for RLF-87

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-87/decouple-agent-into-capabilities-detections-flows-with-an-explicit and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Stage 0 — Characterization tests (regression net)

- [ ] Add `.fails` characterization test: gated ticket + PR conflicted currently routes to `confirmation`; document expectation that it routes to `conflict-fix`.
- [ ] Add `.fails` characterization test: gated ticket + CI failing currently routes to `confirmation`; document expectation that it routes to `ci-fix`.
- [ ] Add `.fails` characterization test: approval persisted + tasks reset for conflict-fix currently re-gates; document expectation that it does not.

### Stage 1 — Event bus + file consumer (additive)

- [ ] Implement `apps/agent/src/agent/shared/events/bus.ts` (typed ring buffer, consumer error isolation, `flush()`).
- [ ] Implement `apps/agent/src/agent/consumers/file-logger.ts` writing JSONL to `~/.ralph/ralphy/logs/<date>.jsonl` with daily rotation and gzip after 14 days.
- [ ] Wire the bus + file consumer in parallel to existing `onLog`/`capture` paths (no behavior change).
- [ ] Add tests: ring overflow emits `bus.dropped`; crashing consumer emits `consumer.error` and loop continues; `flush()` drains pending writes.

### Stage 2 — Pure detections + decouple phase from gate (fixes live bug)

- [ ] Remove `awaiting-confirmation` from `OpenSpecPhase` in `packages/core/src/openspec/phase.ts`; update `derivePlanPhase` accordingly.
- [ ] Add `apps/agent/src/agent/features/confirmation/detect.ts:gateActive(state)` returning `false` whenever `state.confirmation.confirmedAt !== null`.
- [ ] Migrate `classifyAwaitingConfirmation` callers to consume `gateActive` and pure phase separately.
- [ ] Flip the three Stage-0 `.fails` tests to passing assertions.

### Stage 3 — Shared state schema + adopt invariant + PollContext

- [ ] Implement `shared/state/{schema,store.ts,migrations.ts}` with field-level ownership and atomic temp-file-rename writes.
- [ ] Add `adopt()` on Linear attachments capability; test that double-sync on empty state yields one attachment per slot.
- [ ] Implement `shared/capabilities/poll-context.ts` and tests proving identical fetches inside one poll dedupe.

### Stage 4 — Shared capabilities extraction; lint warn

- [ ] Extract `shared/capabilities/{linear-client,gh-client,git,fs-change,worker-spawner}.ts`; declare `{ required, retryPolicy, errorFormatter, adopt? }`.
- [ ] Linear client honors `Retry-After` on 429/5xx (test with mocked responses).
- [ ] Remove `mode` enum from worker spawner; flows prepare their own task-prepend.
- [ ] Add `no-restricted-imports` lint rules (warn level): cross-feature imports, features importing `runtime/` or `consumers/`, consumers importing capabilities/features, I/O imports in `*/detect.ts`.

### Stage 5 — Vertical feature migration

- [ ] Migrate `confirmation` into `features/confirmation/{index.ts,detect.ts,flow.ts,state.ts}`.
- [ ] Migrate `conflict-fix`.
- [ ] Migrate `ci-fix`.
- [ ] Migrate `implement`.
- [ ] Migrate `review-followup` (add `state.review.lastConsumedCommentAt` watermark; regression test that the same comment does not re-fire).
- [ ] Migrate `new-ticket`.
- [ ] Migrate `mention`.
- [ ] Migrate `stuck`.

### Stage 6 — Router + runtime

- [ ] Implement `runtime/router.ts` as the precedence table from design.md.
- [ ] Add fast-check property test: router is total over the `Signals` shape.
- [ ] Implement `runtime/poll.ts` as `gather → classify → route → execute`.
- [ ] Implement `runtime/flow-runner.ts` with SIGTERM 5s grace then SIGKILL preemption.
- [ ] Implement `runtime/coordinator.ts` (worker-slot queue + concurrency only).
- [ ] Implement `runtime/shutdown.ts` (parallel `teardown('cancelled')`, `bus.flush()`, pending-write persistence).
- [ ] Add integration test: SIGINT mid-iteration exits cleanly with all features torn down and bus flushed.

### Stage 7 — Enforcement + assembly cleanup

- [ ] Promote `no-restricted-imports` lint rules from `warn` to `error`.
- [ ] Shrink `wire.ts` to pure assembly (~80% reduction); add test that registering a feature with unmet `requires` throws.
- [ ] Generate `ARCHITECTURE.md` at repo root from the feature registry + router table.
- [ ] Add `--json-output` golden-file tests for `poll_done`, `flow_started`, `flow_completed` (no schema drift).
- [ ] Add PostHog event-name preservation test.

### Stage 8 — Split implement into implement + awaiting-ci

- [ ] Add `features/awaiting-ci/` slice that polls CI without consuming a worker slot.
- [ ] Update router precedence to route post-implement polls through `awaiting-ci`.
- [ ] Update TUI to render phase and flow as two independent surfaces (`AgentMode.tsx`).
- [ ] Update `--json-output` `poll_done` events to carry both `phase` and `flow`; update golden files.

### Verification

- [ ] `bun run lint` passes.
- [ ] `bun run test` passes; coverage threshold not lowered.
- [ ] `bunx openspec validate rlf-87-decouple-agent-into-capabilities-detecti --strict` passes.
- [ ] Manual smoke run: confirmation end-to-end on a real Linear ticket; conflict-fix recovers without re-gating; ci-fix recovers without re-gating; SIGINT mid-iteration exits cleanly.
- [ ] `~/.ralph/ralphy/logs/<date>.jsonl` contains a structured event for every capability call, detection result, router decision, and flow transition during the smoke run.
