# runtime-signals Specification

## Purpose

TBD - created by archiving change rlf-114-integration-tests-runtime-signals-s6-1-s. Update Purpose after archive.

## Requirements

### Requirement: S6.3 — SIGTERM MUST trigger the identical graceful shutdown sequence as SIGINT

SIGTERM MUST produce the full graceful trace — `runtime.shutdown.started`,
per-flow teardown events, `runtime.shutdown.completed`, exit 0 — identically
to SIGINT. A second SIGTERM while shutdown is already in progress MUST
force-exit 130 via the same double-signal guard as the second-SIGINT case.

`installShutdown` registers handlers for both signals through the same
`handler()` factory, so the symmetry is structural, not coincidental.

#### Scenario: first SIGTERM triggers graceful shutdown

- **Given** `installShutdown` is installed with one active flow
- **When** SIGTERM fires once
- **Then** `runtime.shutdown.started` is emitted
- **And** the flow teardown is called and emits its teardown event
- **And** `runtime.shutdown.completed` is emitted
- **And** the process exits 0

#### Scenario: second SIGTERM forces exit 130

- **Given** `installShutdown` is installed with a slow-teardown flow
- **When** SIGTERM fires twice in quick succession
- **Then** the process exits 130 without waiting for teardown

### Requirement: S6.4 — maxTickets=0 MUST behave as unlimited

`AgentCoordinator` MUST treat `maxTickets: 0` (and the case where `maxTickets`
is omitted) as unlimited: `atTicketLimit()` MUST always return `false` and the
coordinator MUST pick up every eligible issue within the concurrency limit.

#### Scenario: three issues, maxTickets=0, concurrency=3

- **Given** three eligible todo issues
- **And** coordinator options `{ concurrency: 3, maxTickets: 0 }`
- **When** `pollOnce()` runs
- **Then** all three issues are spawned
- **And** `ticketsStartedCount` equals 3

#### Scenario: maxTickets omitted behaves the same as 0

- **Given** two eligible todo issues
- **And** coordinator options `{ concurrency: 2 }` (no maxTickets)
- **When** `pollOnce()` runs
- **Then** both issues are spawned

### Requirement: S6.6 — preemption MUST NOT permanently consume a ticket-cap slot

When a worker is restarted (preempted mid-run), `ticketsStarted` MUST be
decremented and the issue MUST be re-queued as a resume. The re-spawn MUST
increment `ticketsStarted` by one again. Net effect: one physical ticket
occupies one logical counter slot over the whole restart cycle.

#### Scenario: restarted worker decrements then re-increments ticketsStarted

- **Given** coordinator with `maxTickets: 1` and one todo issue
- **When** the issue is spawned (`ticketsStarted = 1`)
- **And** `restartWorker` is called and the worker exits
- **Then** `ticketsStarted` stays at 1 after the resume spawns (decremented,
  then incremented back)

### Requirement: S6.7 — pollOnce MUST return early and MUST NOT spawn after stop()

`AgentCoordinator.stop()` MUST prevent all subsequent poll work. Subsequent
calls to `pollOnce()` MUST return an empty `PollResult` immediately, without
fetching from Linear. If `stop()` is called while a poll is already in-flight,
`spawnNext()` MUST return without spawning new workers.

#### Scenario: stop() before pollOnce — no Linear fetch

- **Given** coordinator is stopped before `pollOnce()` is called
- **When** `pollOnce()` is invoked
- **Then** `fetchTodo` is never called
- **And** the returned result has `found = 0` and `added = 0`

#### Scenario: stop() during in-flight poll — no new spawns

- **Given** `pollOnce()` is mid-await on `fetchTodo`
- **When** `stop()` is called and then `fetchTodo` resolves with an issue
- **Then** no worker is spawned for that issue

### Requirement: S6.8 — a stopped coordinator MUST skip all poll work on every call

Repeated calls to `pollOnce()` on a stopped coordinator MUST not invoke any
Linear fetcher, MUST not enqueue anything, and MUST not spawn any workers.
This guards against RSS growth caused by dangling fetch promises.

#### Scenario: five consecutive polls on stopped coordinator

- **Given** coordinator is stopped
- **When** `pollOnce()` is called five times
- **Then** `fetchTodo` is never invoked across all five calls

### Requirement: S6.9 — the coordinator MUST spawn a queued third ticket exactly once

The coordinator MUST NOT double-spawn or skip the next queued ticket when two
concurrent workers exit simultaneously. The queue is drained via synchronous
`shift()` inside `spawnNext()`, which serialises access even when both exit
promises resolve in the same microtask batch.

#### Scenario: concurrency=2, three issues, first two exit simultaneously

- **Given** three eligible todo issues and coordinator with `concurrency: 2`
- **When** `pollOnce()` runs (spawns first two; third stays queued)
- **And** both active workers exit simultaneously
- **Then** the third issue is spawned exactly once
- **And** total spawn count is 3
