# Design — RLF-87

## Goal

Decouple `apps/agent/src/agent/` into four explicit layers — **capabilities** (I/O), **detections** (pure), **flows** (feature-owned), and **router** (pure) — wired together by a thin **runtime** and observed through a single **event bus**. The architecture makes the live bug (recovery flows mis-routed to the confirmation gate) impossible by construction and shrinks the blast radius of future flow additions to a single folder.

## Target directory layout

```
apps/agent/src/agent/
  shared/
    capabilities/     linear-client.ts, gh-client.ts, git.ts, fs-change.ts,
                      worker-spawner.ts, poll-context.ts
    detections/       phase.ts, tasks.ts, pr.ts, ci.ts, signals.ts
    state/            schema.ts, store.ts, migrations.ts
    events/           bus.ts, types.ts
  features/
    confirmation/     index.ts (FeatureModule), detect.ts, flow.ts, state.ts
    conflict-fix/     ...
    ci-fix/           ...
    implement/        ...
    awaiting-ci/      ... (stage 8)
    review-followup/  ...
    new-ticket/       ...
    mention/          ...
    stuck/            ...
  consumers/          file-logger.ts, posthog.ts, tui-stream.ts, json-output.ts
  runtime/            router.ts, poll.ts, coordinator.ts, flow-runner.ts, shutdown.ts
  wire.ts             (assembly only — registers features, capabilities, consumers)
```

## Contracts

### Capability

```ts
interface Capability<T> {
  name: string;
  required: boolean; // wire.ts refuses to start if a feature requires it and it's missing
  build(ctx: WireContext): T;
  retryPolicy?: RetryPolicy; // honors Retry-After on 429/5xx (linear-client)
  errorFormatter?: (e: unknown) => string;
  adopt?: (existing: unknown) => unknown; // for resources already present (e.g. linear attachments)
}
```

### Detection

Pure functions in `shared/detections/*.ts` — no I/O, no mutation, no direct `Date.now()` (read `runtime.now`). They consume `PollContext` snapshots and produce typed values that feed into `Signals`.

### Signal contribution

Features extend a single `Signals` shape via TypeScript module augmentation:

```ts
declare module "@/shared/detections/signals" {
  interface Signals {
    confirmation: {
      gateActive: boolean;
      reviseComment: ReviseComment | null;
      roundsExhausted: boolean;
    };
  }
}
```

Router code reads `signals.confirmation.gateActive`. Forgetting to declare a contribution is a compile-time error where the router uses it.

### FeatureModule

```ts
interface FeatureModule {
  name: FlowName;
  requires: CapabilityName[];
  stateFields: string[]; // dotted paths
  stateFieldOwnership: Record<string, FlowName>; // single writer per field
  eventTypes: string[]; // for bus type narrowing
  contributeSignals?(ctx: RuntimeContext): Promise<Partial<Signals>>;
  flow: {
    start?(ctx, assignment): Promise<void>;
    tick(ctx, assignment): Promise<TickResult>;
    teardown(ctx, reason: "completed" | "preempted" | "cancelled"): Promise<void>;
    postTask?(ctx): Promise<void>;
  };
  triggers: (signals: Signals, state: State) => boolean;
}
```

### Router

```ts
function route(signals: Signals, state: State): FlowAssignment;
```

Pure. Total over the signal space. Implemented as an ordered precedence table:

| Priority | Trigger                                    | Flow                    |
| -------- | ------------------------------------------ | ----------------------- |
| 1        | `signals.shutdown`                         | `shutdown`              |
| 2        | `signals.conflict.prConflicted`            | `conflict-fix`          |
| 3        | `signals.ci.failing`                       | `ci-fix`                |
| 4        | `signals.review.unconsumedReviewerComment` | `review-followup`       |
| 5        | `signals.mention.unconsumed`               | `mention`               |
| 6        | `signals.confirmation.gateActive`          | `confirmation`          |
| 7        | `signals.confirmation.reviseComment`       | `confirmation` (revise) |
| 8        | `signals.newTicket`                        | `new-ticket`            |
| 9        | `signals.phase === "implement"`            | `implement`             |
| 10       | `signals.stuck`                            | `stuck`                 |
| —        | (default)                                  | `idle`                  |

Conflict-fix and ci-fix above the confirmation gate is what fixes the live bug structurally: a recovery flow can never be re-gated.

### State store

```ts
store.writeField(owner: FlowName, path: string, value: unknown)  // throws if owner !== stateFieldOwnership[path]
store.read(): State                                              // immutable snapshot
```

Migration on read: legacy `state.phase === "awaiting-confirmation"` is lifted to `{ phase: derivePlanPhase(...), confirmation: { gateActive: true, confirmedAt: null } }`.

### Event bus

```ts
bus.emit<T extends EventType>(event: TypedEvent<T>): void
bus.subscribe(consumer: Consumer): Unsubscribe
bus.flush(): Promise<void>   // drains pending writes before shutdown
```

Ring buffer (size 4096) drops oldest on overflow and records a `bus.dropped` counter event. Consumer exceptions are caught and re-emitted as `consumer.error` — one bad consumer cannot crash the loop.

### Runtime context

```ts
interface RuntimeContext {
  now: () => number;
  change: ChangeIdentity;
  capabilities: Capabilities;
  state: StateReader;
  pollCache: PollContext;
  bus: EventBus;
}
```

## Invariants (test-enforced)

1. `derivePlanPhase` never returns `awaiting-confirmation`.
2. Confirmation gate is `false` whenever `state.confirmation.confirmedAt !== null`.
3. Router is total over the signal space (fast-check property test).
4. Router precedence: gated ticket + PR conflicted → `conflict-fix`. Gated ticket + CI failing → `ci-fix`.
5. State writes from a non-owning feature throw at runtime and fail type-check.
6. `wire.ts` refuses to register a feature whose `requires` capability is not provided.
7. PollContext memoises identical Linear/gh/comment fetches within one poll.
8. Linear capability honors `Retry-After` on 429/5xx.
9. `adopt()` is idempotent: spec attachment sync twice on empty state yields one attachment per slot.
10. Reviewer-comment watermark prevents re-firing the same comment across polls.
11. `bus.flush()` drains before `process.exit` on SIGINT/SIGTERM.
12. Consumer exceptions do not crash the poll loop.
13. PostHog event names and `--json-output` schema are unchanged (golden-file tests).
14. `no-restricted-imports` lint forbids cross-feature imports, features importing `runtime/` or `consumers/`, consumers importing capabilities/features, and any I/O imports in `*/detect.ts`.

## Data flow per poll

```
runtime/poll.ts:
  1. gather:    capabilities snapshot + PollContext caches (Linear, gh, fs)
  2. classify:  each feature's contributeSignals → merge into Signals
  3. route:     router.route(signals, state) → FlowAssignment
  4. execute:   flow-runner runs assignment.flow.tick(ctx, assignment)
  5. consume:   bus events fanned out to file-logger, posthog, tui-stream, json-output
```

`flow-runner` supports **preemption**: if the router selects a different flow next poll, the runner sends SIGTERM to the active worker, waits 5s, then SIGKILL, and calls `teardown('preempted')`.

`shutdown` (SIGINT/SIGTERM): all features' `teardown('cancelled')` run in parallel, then `bus.flush()`, then pending state writes are persisted, then `process.exit`.

## Edge cases

- **Linear rate limit** — `linear-client.retryPolicy` honors `Retry-After`. PollContext deduplicates concurrent fetches inside a single poll.
- **Worker process exits unexpectedly** — `worker-spawner` emits `worker.exit` with exit code; `flow-runner` calls `teardown('completed' | 'preempted')` based on whether a preemption was in flight.
- **State file truncation mid-write** — store writes via temp file + atomic rename; on read failure, falls back to last good snapshot and logs `state.corrupt`.
- **Bus ring overflow** — oldest events dropped; counter event emitted so the file logger records the drop.
- **Consumer crash mid-event** — caught; `consumer.error` re-emitted; consumer continues receiving subsequent events.
- **Schema drift in `--json-output`** — golden-file tests pin `poll_done`, `flow_started`, `flow_completed` shapes.

## Files touched (representative)

- New: `apps/agent/src/agent/{shared,features,consumers,runtime}/**` (~80 files across stages).
- Modified: `apps/agent/src/agent/wire.ts` (shrinks ~80% to assembly), `apps/agent/src/agent/coordinator.ts` (worker-slot queue only), `packages/core/src/openspec/phase.ts` (remove `awaiting-confirmation`), `apps/agent/src/components/AgentMode.tsx` (phase + flow surfaces), `apps/agent/src/agent/json-output.ts` (carry both `phase` and `flow`).
- Generated: `ARCHITECTURE.md` at repo root from feature registry + router table.

## Rollout

Eight PRs, one per stage. CI green at every boundary. Lint rules ship as `warn` in stage 4, promoted to `error` in stage 7. Each stage's regression tests stay green for the rest of the rollout.
