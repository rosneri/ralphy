# event-bus Specification

## Purpose

TBD - created by archiving change rlf-90-stage-1-event-bus-file-consumer-additive. Update Purpose after archive.

## Requirements

### Requirement: The repository MUST provide a synchronous in-process event bus in `@ralphy/events`

The repository MUST ship a new workspace package `@ralphy/events`
(located at `packages/events/`) that exposes a
`createBus(capacity?: number)` factory. The factory MUST return an
object with the following surface:

- `emit(event)` — synchronously timestamps the event (if `ts` is
  missing), appends it to an internal ring buffer, and dispatches it to
  every subscriber registered for that event's `type` plus every
  subscriber registered for the `"*"` wildcard. Listener invocation
  order MUST equal subscription order.
- `on(type, listener)` — registers a listener for a specific event
  `type` or the `"*"` wildcard. Returns an `unsubscribe()` function that
  removes the listener.
- `snapshot()` — returns a chronologically ordered shallow copy of the
  events currently held in the ring (oldest first).

`capacity` MUST default to 2000. The bus MUST be **purely synchronous**:
no microtask, no `queueMicrotask`, no `setImmediate`, no promise-based
fan-out.

#### Scenario: emit delivers events to subscribers in registration order

- **Given** a bus with two subscribers registered for type `log` in order A, B
- **When** `bus.emit({ type: "log", text: "hi" })` is called
- **Then** subscriber A is invoked before subscriber B
- **And** both receive the same event object with `ts` populated to a number

#### Scenario: `*` wildcard receives every event

- **Given** a bus with one subscriber registered for `"*"`
- **When** events of two different types are emitted
- **Then** the wildcard subscriber is invoked once per emitted event in
  emission order

#### Scenario: unsubscribe stops further delivery

- **Given** a subscriber registered via `bus.on(...)` and immediately
  unsubscribed
- **When** an event of that type is emitted
- **Then** the unsubscribed listener is NOT invoked

### Requirement: The bus MUST isolate subscriber errors

If a subscriber throws (synchronously) inside its listener, the bus MUST:

1. Catch the thrown value.
2. Continue iterating remaining subscribers for the same event so they
   still receive the event.
3. Emit a follow-up event of type `__bus_error__` carrying the failing
   consumer's name (string identifier passed at `on(...)` time, defaulting
   to `"anonymous"`), the error's `message`, and (when present) `stack`.
4. NOT re-invoke the failing subscriber as part of `__bus_error__`
   delivery, and MUST guard against unbounded recursion if the
   `__bus_error__` listener itself throws (depth ≤ 4).

A unit test in `packages/events/src/__tests__/bus.test.ts` MUST cover
this scenario explicitly.

#### Scenario: a throwing subscriber does not break emit

- **Given** subscribers A (throws `new Error("boom")`), B (records), and C
  (records) registered in that order for type `log`
- **When** `bus.emit({ type: "log", text: "x" })` is called
- **Then** B and C both record the `log` event
- **And** a `__bus_error__` event is emitted with `error_message: "boom"`
- **And** no exception propagates out of `emit()`

### Requirement: A fixed-size ring buffer MUST back the bus

`@ralphy/events` MUST expose a `createRing<T>(capacity)` utility that:

- Stores up to `capacity` items in insertion order.
- Overwrites the oldest item when full (FIFO eviction).
- Exposes `snapshot(): T[]` returning items in chronological order
  (oldest first).

The bus MUST use a ring with the configured capacity (default 2000) as
the backing store for `snapshot()`.

#### Scenario: ring overwrites oldest entries when full

- **Given** a ring with capacity 3
- **When** 5 items numbered 1..5 are pushed
- **Then** `snapshot()` returns `[3, 4, 5]`

### Requirement: A JSONL file consumer MUST log every event with daily rotation and 14-day gzip

`@ralphy/events/consumers/file-logger.ts` MUST export
`subscribeFileLogger(bus, opts?)` that, while subscribed, appends every
emitted event to `<root>/logs/<YYYY-MM-DD>.jsonl` as one JSON object per
line. `<root>` MUST resolve to `opts.rootDir`, else `RALPH_HOME`
environment variable, else `join(homedir(), ".ralph", "ralphy")`.
`<YYYY-MM-DD>` MUST be derived from the event's own `ts` field
interpreted as a local date.

On `subscribeFileLogger(...)` startup the consumer MUST run a
best-effort housekeeping pass that gzips and removes any `*.jsonl` file
in the logs directory whose date prefix is older than 14 days relative
to the current local date. Failures during housekeeping or per-event
writes MUST NOT throw out of the bus; they MUST be re-emitted as
`__bus_error__` events.

The consumer MUST use Bun-native APIs (`Bun.file(...).writer(...)`,
`Bun.gzipSync(...)`, `new Bun.Glob(...)`) wherever Bun provides them.

#### Scenario: events from two different local dates land in two files

- **Given** `subscribeFileLogger(bus, { rootDir: tmpdir })` is attached
- **When** an event with `ts` on 2026-01-01 and another on 2026-01-02
  are emitted in that order
- **Then** `tmpdir/logs/2026-01-01.jsonl` exists and contains the first
  event
- **And** `tmpdir/logs/2026-01-02.jsonl` exists and contains the second

#### Scenario: files older than 14 days are gzipped and removed on startup

- **Given** a `tmpdir/logs/` directory containing `2025-12-01.jsonl`
  with non-zero bytes and the current local date is 2026-01-01
- **When** `subscribeFileLogger(bus, { rootDir: tmpdir })` is called
- **Then** after the startup pass `tmpdir/logs/2025-12-01.jsonl` no
  longer exists
- **And** `tmpdir/logs/2025-12-01.jsonl.gz` exists with valid gzip bytes
  whose inflated content equals the original file

#### Scenario: a write failure is swallowed and surfaced as `__bus_error__`

- **Given** the file-logger is configured with an unwritable `rootDir`
- **When** an event is emitted
- **Then** `emit()` returns normally
- **And** a `__bus_error__` event with `consumer: "file-logger"` is
  observed by a `"*"` listener installed before the file-logger

### Requirement: A PostHog consumer MUST forward an allowlisted subset of events to `@ralphy/telemetry.capture`

`@ralphy/events/consumers/posthog.ts` MUST export `subscribePostHog(bus,
captureFn)` and a `POSTHOG_EVENT_ALLOWLIST: ReadonlySet<RalphEventType>`
const. While subscribed, for every event whose `type` is in the
allowlist the consumer MUST call `captureFn(event.type, properties)`
where `properties` is the event object with `type` and `ts` omitted.

The allowlist MUST contain every event name currently emitted by
`capture(...)` in the repository, pinned by a fixture test
(`packages/events/src/__tests__/posthog-event-names.test.ts`) that
diff-checks it against the union of `event` names found in the Stage 0
PostHog golden
(`apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl`) and the
explicit grep-derived list documented in `design.md`.

This consumer runs **alongside** the existing `capture(...)` call sites
in Stage 1; it does NOT replace them.

#### Scenario: an allowlisted event is forwarded to capture

- **Given** `subscribePostHog(bus, fakeCapture)` is attached and
  `agent_worker_spawned` is on the allowlist
- **When** `bus.emit({ type: "agent_worker_spawned", change_name: "x", pid: 1 })`
  is called
- **Then** `fakeCapture` is called once with
  `("agent_worker_spawned", { change_name: "x", pid: 1 })`

#### Scenario: a non-allowlisted event is dropped

- **Given** `subscribePostHog(bus, fakeCapture)` is attached and
  `worker_output` is NOT on the allowlist
- **When** a `worker_output` event is emitted
- **Then** `fakeCapture` is NOT called

#### Scenario: the allowlist fixture covers every current capture event name

- **Given** the Stage 0 PostHog golden file
- **When** the fixture test reads every `event` name from the golden
- **Then** every such name is present in `POSTHOG_EVENT_ALLOWLIST`

### Requirement: TUI-stream and JSON-output consumers MUST run in shadow mode in Stage 1

The TUI-stream and JSON-output consumers MUST run in shadow mode during
Stage 1 — they MUST write to in-memory buffers only and MUST NOT write
to `process.stdout` or Ink.

`@ralphy/events/consumers/tui-stream.ts` and
`@ralphy/events/consumers/json-output.ts` MUST each export a
`subscribeTuiStream(bus, sink)` / `subscribeJsonOutput(bus, sink)`
factory that writes to the supplied `sink: { write(line: string): void }`.
In Stage 1 the agent and loop entry points MUST construct an in-memory
`BufferSink` for each — no writes reach `process.stdout`, Ink, or the
user.

The `json-output` consumer MUST emit
`JSON.stringify({ ts, type, …rest }) + "\n"` for every event whose
`type` matches `runAgentJson`'s documented set (`started`, `log`,
`poll_start`, `poll_done`, `worker_started`, `worker_exited`,
`worker_phase`, `worker_output`, `worker_cmd_start`, `worker_cmd_end`,
`worker_pr`, `awaiting_confirmation`, `stopped`), preserving the
property names today produced by `apps/agent/src/agent/json-runner.ts`.

A shadow-mode test
(`packages/events/src/__tests__/shadow-mode.test.ts`) MUST install both
consumers during a happy-path characterization run and assert the
captured buffers, after the existing normalisation pipeline, equal the
Stage 0 golden files
(`apps/agent/src/__tests__/__golden__/json-output-new-ticket.jsonl`)
byte-for-byte.

#### Scenario: shadow JSON output matches Stage 0 golden

- **Given** a happy-path characterization run with `subscribeJsonOutput`
  attached
- **When** the run completes
- **Then** the buffer-sink contents, after normalisation, equal the
  Stage 0 `json-output-new-ticket.jsonl` golden byte-for-byte

#### Scenario: shadow consumers never write to stdout

- **Given** Stage 1 entry-point wiring with `BufferSink`
- **When** the agent runs end-to-end
- **Then** `process.stdout.write` is invoked only by the existing
  legacy code paths (verified by a spy in the test) — never by either
  shadow consumer

### Requirement: Existing `onLog(...)` and `capture(...)` call sites MUST also emit onto the bus

Every existing legacy log/telemetry call site MUST gain a co-located
bus emit. Specifically, every existing call to `capture(...)` in
`apps/shell/src/index.ts`, `apps/loop/src/hooks/useLoop.ts`, and
`apps/agent/src/agent/coordinator.ts`, plus every `onLog(...)` call in
`apps/agent/src/agent/coordinator.ts` and the `process.stdout.write`
JSON emit in `apps/agent/src/agent/json-runner.ts`, MUST gain a
co-located `bus.emit({ type, …props })` call carrying the same payload.
The original call MUST remain in place — Stage 1 is additive only.

The bus is threaded through `AgentCoordinator.deps.bus` (optional,
defaults to a no-op bus) and through the loop's existing context import
chain, so existing tests that construct a coordinator without a bus
continue to compile and pass without modification.

#### Scenario: a coordinator log emits a `log` bus event

- **Given** a coordinator constructed with a real bus and a recording
  `"*"` subscriber
- **When** a code path that calls `this.deps.onLog("hello", "red")` runs
- **Then** the subscriber records exactly one event of shape
  `{ type: "log", text: "hello", color: "red", ts: <number> }`
- **And** the original `onLog` callback is still invoked

#### Scenario: a coordinator capture emits the same-name bus event

- **Given** a coordinator constructed with a real bus and a recording
  subscriber for `agent_worker_spawned`
- **When** the worker-spawn code path runs
- **Then** the subscriber records a `agent_worker_spawned` event
  carrying the same properties passed to `capture(...)`
- **And** the original `capture(...)` is still invoked

### Requirement: Emitting 1000 events through all consumers MUST stay within the per-tick wall-clock budget

Emitting 1000 events MUST complete within the per-tick wall-clock budget (≤ 50 ms on the test machine) through all four default consumers in a single synchronous tick. A perf test
(`packages/events/src/__tests__/perf-1000-per-tick.test.ts`) MUST
construct a bus with all four default consumers subscribed (file logger
pointed at a tmpdir, PostHog consumer wired to a no-op capture, both
shadow consumers wired to buffer sinks) and emit 1000 events of mixed
types in a single synchronous loop. The total wall-clock time of the
loop MUST be ≤ 50 ms on the test machine.

#### Scenario: 1000 events in a single tick

- **Given** a bus with all four consumers subscribed
- **When** 1000 events are emitted in a tight `for` loop
- **Then** `performance.now()` after the loop minus the value before is
  ≤ 50 ms
- **And** the file-logger's housekeeping pass has not run during the
  loop (it runs only at `subscribeFileLogger` time)
