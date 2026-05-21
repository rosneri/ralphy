# Tasks for RLF-95

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-95/stage-6-router-runtime and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Create `apps/agent/src/runtime/types.ts` exporting `RouterSignals`, `BoostBand`, `FlowAssignment`, and `RouterRow` per `design.md`.
- [x] Create `apps/agent/src/runtime/router.ts` with the readonly precedence table from `design.md` and a pure `route(signals): FlowAssignment` function whose last row is the `idle` catch-all.
- [x] Add `apps/agent/src/runtime/__tests__/router.test.ts` — one `it()` per row asserting a representative `RouterSignals` triggers the row's `flowId`; plus a test that the table's last row is the `idle` catch-all.
- [x] Add `apps/agent/src/runtime/__tests__/router.property.test.ts` using `fast-check` to assert `route(signals)` is total over the cross-product of `RouterSignals`'s union-typed fields (never throws, always returns a known `flowId`).
- [x] Create `apps/agent/src/runtime/flow-runner.ts` with `run(assignment)` and `preempt(worker, newAssignment)`; preempt MUST SIGTERM, wait 5s, SIGKILL, call `teardown('cancelled')`, persist the new flow, and emit `runtime.preempt.{started,completed}`.
- [x] Add `apps/agent/src/runtime/__tests__/flow-runner-preempt.test.ts` that spawns a fake worker via `Bun.spawn`, drives `preempt`, and asserts the SIGTERM → SIGKILL → teardown → persist sequence.
- [x] Create `apps/agent/src/runtime/coordinator.ts` containing only the queue + concurrency + per-issue dedupe + `maxTickets` throttle. No Linear fetch, no classify, no route, no feature-specific branches.
- [x] Reduce `apps/agent/src/agent/coordinator.ts` to a re-export shim that forwards public types and the `AgentCoordinator` class from `runtime/coordinator.ts`, keeping external callers (CLI, AgentMode, json-runner) compiling without import churn.
- [x] Create `apps/agent/src/runtime/poll.ts` exposing `pollOnce(deps)` that runs `gather → classify → route → execute` against the existing capabilities and the new router; assert via test that all four stages run in order.
- [x] Add `apps/agent/src/runtime/__tests__/poll.test.ts` smoke test wiring fakes for each stage and asserting one call each, in order.
- [x] Create `apps/agent/src/runtime/shutdown.ts` exporting `installShutdown({ runtime, bus, log })` that handles SIGINT/SIGTERM per `design.md`: parallel `teardown('cancelled')` under 10s, `bus.flush()`, log close, `process.exit(0)`; second signal → exit 130.
- [x] Update `apps/agent/src/agent/json-runner.ts` and `apps/agent/src/components/AgentMode.tsx` so their SIGINT/SIGTERM handlers delegate to `runtime/shutdown.ts` instead of running teardown themselves (UI keeps the "press again to force quit" UX by tracking the second-signal escalation).
- [x] Add `apps/agent/src/runtime/__tests__/shutdown.test.ts` that spawns a child agent via `Bun.spawn` with one active fake flow, sends SIGINT, and asserts: exit 0, JSON log is intact line-delimited JSON, and contains `runtime.shutdown.started` → `runtime.shutdown.teardown.<flowId>` → `runtime.shutdown.completed`.
- [x] Wire boost bands as the `boost` column of `RouterSignals`/`FlowAssignment` and make `runtime/coordinator.ts`'s queue sort by boost (p0 first) then FIFO age within a band; add a unit test for the sort.
- [x] Run `bunx openspec validate rlf-95-stage-6-router-runtime` and resolve any failures.
- [x] Run `bun run lint` from the repo root and resolve any failures.
- [x] Run `bun run test` from the repo root and resolve any failures; confirm the coverage threshold is unchanged.
- [x] Stage and commit each touched file individually (no `git add -A`, no `git commit -am`); push the branch with `git push -u origin HEAD`.
- [x] Open the PR with `gh pr create --title "rlf-95-stage-6-router-runtime"` and a body summarising the runtime split, the router precedence table, preemption, shutdown, and the test additions.
