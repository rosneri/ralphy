# agent-runtime-router Specification

## Purpose

TBD - created by archiving change rlf-95-stage-6-router-runtime. Update Purpose after archive.

## Requirements

### Requirement: The agent runtime MUST live under `apps/agent/src/runtime/`

The agent MUST host its polling pipeline, pure router, queue +
concurrency throttle, flow runner, and graceful-shutdown handler under a
dedicated `apps/agent/src/runtime/` directory. The directory MUST
contain at minimum:

- `runtime/types.ts` — shared `RouterSignals`, `FlowAssignment`,
  `BoostBand`, and `RouterRow` types.
- `runtime/router.ts` — pure precedence table and `route()` function.
- `runtime/poll.ts` — `pollOnce()` implementing `gather → classify →
route → execute`.
- `runtime/coordinator.ts` — queue + concurrency only.
- `runtime/flow-runner.ts` — worker spawn + lifecycle + preemption.
- `runtime/shutdown.ts` — SIGINT/SIGTERM graceful exit.
- `runtime/__tests__/` — colocated tests, including the row tests, the
  fast-check property test, the preemption test, and the shutdown test.

No file under `apps/agent/src/runtime/` MAY contain feature-specific
`if (issue.flow === "ci-fix")`-style branching; routing decisions MUST
flow through `router.ts`'s precedence table.

#### Scenario: Runtime directory exists with the required modules

- **Given** the post-Stage-6 tree
- **When** I list `apps/agent/src/runtime/`
- **Then** the files `types.ts`, `router.ts`, `poll.ts`,
  `coordinator.ts`, `flow-runner.ts`, and `shutdown.ts` all exist
- **And** the `__tests__/` directory contains `router.test.ts`,
  `router.property.test.ts`, `flow-runner-preempt.test.ts`,
  `shutdown.test.ts`, and `poll.test.ts`

### Requirement: The router MUST be a pure precedence table total over the signal space

`apps/agent/src/runtime/router.ts` MUST export a `route(signals:
RouterSignals): FlowAssignment` function backed by a readonly `RouterRow[]`
precedence table. The function MUST be **pure** — no I/O, no clock reads,
no bus emissions — and MUST be **total**: for every value of
`RouterSignals` in the cross-product of its union-typed fields, `route`
MUST return a defined `FlowAssignment` and MUST NOT throw.

The last row in the table MUST be a catch-all whose `when` returns
`true` and whose `flowId` is `"idle"`, so totality is statically
obvious.

Boost bands (RLF-12 / RLF-36) MUST be propagated as the
`FlowAssignment.boost` field, copied from `signals.boost`. The queue in
`runtime/coordinator.ts` MUST sort pending assignments by boost (p0
first, then by FIFO age within a band).

#### Scenario: Every router row has a passing row-level test

- **Given** the `RouterRow[]` table in `runtime/router.ts`
- **When** `bun run test apps/agent/src/runtime/__tests__/router.test.ts`
  runs
- **Then** there is at least one `it()` per row that constructs a
  representative `RouterSignals` and asserts `route(signals).flowId`
  equals the row's `flowId`

#### Scenario: Router is total over the enumerable signal space

- **Given** the fast-check property test
  `runtime/__tests__/router.property.test.ts`
- **When** `bun run test` runs
- **Then** for the full cross-product of `RouterSignals`'s union-typed
  fields, `route(signals)` returns a `FlowAssignment` whose `flowId` is
  one of the known ids
- **And** no invocation throws
- **And** no invocation returns `undefined`

#### Scenario: Higher-priority rows beat lower-priority rows

- **Given** `RouterSignals` with `bucket === "review"` and `awaiting ===
"awaiting"`
- **When** `route(signals)` is called
- **Then** the returned `flowId` is `"confirmation"`, not `"review-followup"`
- **Because** the awaiting row precedes the review row in the table

### Requirement: `poll.ts` MUST implement gather → classify → route → execute

`apps/agent/src/runtime/poll.ts` MUST expose a `pollOnce(deps)` function
that runs exactly four stages, in order:

1. **gather** — fetch Linear buckets and mentions via the existing
   capability bundle (no new I/O introduced by this stage).
2. **classify** — build one `RouterSignals` per issue using the Stage 2
   pure detections from `packages/*`.
3. **route** — call `router.route(signals)` to produce one
   `FlowAssignment` per issue.
4. **execute** — hand each assignment to `runtime/flow-runner.ts` via
   the queue in `runtime/coordinator.ts`.

`poll.ts` MUST NOT contain feature-specific branching, MUST NOT spawn
workers directly (delegates to `flow-runner.ts`), and MUST NOT mutate
`.ralph-state.json` directly (slot writes flow through the feature's
`StateStore`).

#### Scenario: Poll smoke test wires the four stages

- **Given** fake gather/classify/router/flow-runner injected into
  `pollOnce`
- **When** the smoke test runs
- **Then** the fakes are called exactly once each, in order:
  gather → classify → route → execute

### Requirement: `coordinator.ts` MUST own queue and concurrency only

`apps/agent/src/runtime/coordinator.ts` MUST be reduced to a class that
owns the bounded queue of pending `FlowAssignment`s, the per-issue
dedupe set, and the `concurrency` / `maxTickets` throttle. It MUST NOT
fetch Linear, MUST NOT classify, MUST NOT route, and MUST NOT contain
feature-specific behavior.

`apps/agent/src/agent/coordinator.ts` MAY remain as a thin re-export
shim that forwards `AgentCoordinator` and its public types from
`runtime/coordinator.ts`, so external callers continue compiling without
import churn during the transition. The shim MUST NOT add behavior of
its own.

#### Scenario: Coordinator has no feature-specific imports

- **Given** the post-Stage-6 `runtime/coordinator.ts`
- **When** I grep its imports
- **Then** it imports no module under `apps/agent/src/features/`
- **And** it imports no module under `apps/agent/src/agent/{ci,pr,confirmation,…}`

### Requirement: `flow-runner.ts` MUST preempt active workers under a 5s grace

`apps/agent/src/runtime/flow-runner.ts` MUST detect when a new
`FlowAssignment` for an issue has a higher precedence than the issue's
currently running flow (lower table-row index = higher precedence) and
preempt the running worker as follows:

1. Emit `runtime.preempt.started { issueId, from, to }` on the shared bus.
2. Send `SIGTERM` to the worker subprocess.
3. Wait up to **5000 ms** for the process to exit.
4. If still alive, send `SIGKILL` and await the exit promise.
5. Invoke `feature.teardown?.(ctx, "cancelled")` (tolerating absence —
   the contract is finalised in Stage 7).
6. Persist the new `flow` for the issue under the owning feature's
   `state.*` slot.
7. Emit `runtime.preempt.completed { issueId, to }`.

The new assignment MUST be enqueued only after step 7.

#### Scenario: Preemption flips a working issue to confirmation

- **Given** issue I in `implement` with an active worker W
- **And** a `revise` comment lands on I, producing a new
  `FlowAssignment{ flowId: "confirmation" }`
- **When** `flow-runner.preempt(W, newAssignment)` runs
- **Then** W receives SIGTERM
- **And** within 5000 ms W has exited (SIGKILL if needed)
- **And** `teardown('cancelled')` is invoked for W's flow
- **And** `.ralph-state.json` for I records the new flow
- **And** the bus contains `runtime.preempt.started` then
  `runtime.preempt.completed` for I

### Requirement: `shutdown.ts` MUST drain active flows gracefully on SIGINT/SIGTERM

`apps/agent/src/runtime/shutdown.ts` MUST register a single
SIGINT/SIGTERM handler. On the first signal it MUST:

1. Emit `runtime.shutdown.started { signal }`.
2. Mark the runtime stopped so no new work is dequeued.
3. Run `feature.teardown?.(ctx, "cancelled")` for every active flow in
   parallel under a **10000 ms** hard timeout.
4. Emit `runtime.shutdown.teardown.<flowId>` per settled flow.
5. `await bus.flush()` to drain the event ring.
6. Close the JSON log file (Bun.file writer flush).
7. Emit `runtime.shutdown.completed { durationMs }`.
8. `process.exit(0)`.

A **second** signal received during the 10s window MUST exit with code
130 immediately, skipping the remaining teardown.

The legacy SIGINT/SIGTERM handlers in `apps/agent/src/components/AgentMode.tsx`
and `apps/agent/src/agent/json-runner.ts` MUST delegate to
`runtime/shutdown.ts` rather than implementing teardown themselves.

#### Scenario: SIGINT during an active flow yields a graceful exit

- **Given** an agent process P with one active flow F
- **When** P receives SIGINT
- **Then** P exits with code 0 within 10500 ms
- **And** the JSON log file is intact (parses as line-delimited JSON
  without truncation)
- **And** the log contains `runtime.shutdown.started`,
  `runtime.shutdown.teardown.<F.flowId>`, and
  `runtime.shutdown.completed` records, in order

#### Scenario: Second SIGINT escalates to immediate exit

- **Given** an agent process P that has just received its first SIGINT
  and is mid-teardown
- **When** a second SIGINT arrives within 10s
- **Then** P exits with code 130 without waiting for remaining
  teardowns

### Requirement: The coordinator MUST cap launched tickets at `--max-tickets` even when `--concurrency` exceeds the cap

The coordinator MUST start at most `N` issues per process run when `maxTickets` is set to a positive integer `N` and `concurrency` is set to `C > N`.
Additional eligible issues visible in the same poll MUST NOT be launched
to fill the remaining `C - N` concurrency slots; those slots MUST remain
idle until the cap is lifted (which happens only on a fresh process run).

The cap MUST be enforced before a worker is spawned, not after, so the
regression signature ("two workers spawned — cap breached") cannot occur.

#### Scenario: --max-tickets 1 with --concurrency 2 and two eligible tickets

- **Given** the coordinator is started with `--max-tickets 1` and
  `--concurrency 2`
- **And** two eligible Linear issues are visible in the same poll
- **When** the coordinator enqueues work from that poll
- **Then** exactly one worker is launched for the first issue
- **And** the second concurrency slot stays idle while the first worker
  runs
- **And** the second issue is not started even after the first worker
  finishes (the cap stops new launches, it does not gate them)
