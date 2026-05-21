# RLF-87: Decouple agent into capabilities / detections / flows with an explicit router

Source: [RLF-87](https://linear.app/neriros/issue/RLF-87/decouple-agent-into-capabilities-detections-flows-with-an-explicit)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Why

Today the agent (`apps/agent/src/agent/wire.ts` + `coordinator.ts`) tangles three concerns in one layer:

1. **I/O capabilities** — Linear API, GitHub `gh`, filesystem, git, worker spawning — scattered with ad-hoc retry, caching, and error formatting at each call site.
2. **Detections** — phase derivation, gate detection, PR/CI state, mention/review signals — mixed with I/O and mutation (most visibly `classifyAwaitingConfirmation` in `wire.ts`, which detects, mutates state, posts comments, and reaps workers in one function).
3. **Flows** — new-ticket, confirmation, implement, conflict-fix, ci-fix, review-followup, mention, stuck — encoded as branches inside the coordinator's poll loop with implicit priorities.

This conflation has produced a recurring bug class (RLF-44, RLF-70, RLF-71, RLF-78, RLF-84, RLF-59, RLF-58, RLF-39, RLF-60, RLF-65, RLF-66–69, RLF-82). The live trigger: conflict-fix and ci-fix flows are mis-classified as `awaiting-confirmation` because `derivePlanPhase` in `packages/core/src/openspec/phase.ts` conflates structural phase with the behavioral gate — adding an unchecked task during recovery flips a confirmed change back to the gate.

This umbrella tracks the staged refactor that fixes that bug class by construction. The implementation is broken into sub-issues; this change captures the contract every stage must respect.

## What Changes

- Restructure `apps/agent/src/agent/` into vertical feature slices: `shared/`, `features/<name>/` (confirmation, conflict-fix, ci-fix, implement, review-followup, new-ticket, mention, stuck), `consumers/`, `runtime/`.
- Add an in-memory typed event bus (`shared/events/bus.ts`) with a fixed-size ring buffer and consumer error isolation. Every capability call, detection result, router decision, and flow transition emits a typed event.
- Add write-only consumers (`consumers/file-logger.ts`, `consumers/posthog.ts`, `consumers/tui-stream.ts`, `consumers/json-output.ts`). File logger writes JSONL to `~/.ralph/ralphy/logs/<date>.jsonl` with daily rotation; PostHog and `--json-output` consumers preserve existing event names/schemas (golden-file regression tests).
- Extract pure detections (`shared/detections/{phase,tasks,pr,ci,signals}.ts`). `derivePlanPhase` returns only `proposal | design | tasks | implement | done` — `awaiting-confirmation` is removed from `OpenSpecPhase`. Gating becomes `features/confirmation/detect.ts:gateActive(...)`, which returns `false` whenever `state.confirmation.confirmedAt !== null`. **This is the fix for the live bug.**
- Extract shared capabilities (`shared/capabilities/{linear-client,gh-client,git,fs-change,worker-spawner,poll-context}.ts`). Each declares `{ required, retryPolicy, errorFormatter, adopt? }`. Worktree creation is `required: true`. Worker spawner takes `{ cwd, changeName, steeringNote?, prependTask? }` — the `mode` enum is removed.
- Add `PollContext` per-poll cache that memoises Linear / `gh` / comment fetches across features.
- Add single-writer state store (`shared/state/{schema,store.ts}`) with field-level ownership; `store.writeField(featureName, dottedPath, value)` rejects unowned writes. Schema migration on read lifts old state files into the new shape.
- Add `RuntimeContext` passed to every flow method and signal-producing detection.
- Add a typed `Signals` contract via module augmentation (forgetting to register a contribution is a compile-time error at the router site) and a `FeatureModule` contract that `wire.ts` validates against configured capabilities.
- Add a pure router (`runtime/router.ts`): `(signals, state) → FlowAssignment`. Total over the signal space (fast-check property test). Precedence table places `conflict-fix` and `ci-fix` above the confirmation gate.
- Add `runtime/{poll,coordinator,flow-runner,shutdown}.ts`. `flow-runner` supports preemption (SIGTERM 5s grace then SIGKILL). `shutdown` runs `teardown('cancelled')`, `bus.flush()`, and pending-write persistence in parallel before exit.
- Add `adopt()` on Linear attachments capability so running spec attachment sync twice on empty state yields exactly one attachment per slot (regression net for RLF-84).
- Add reviewer-comment watermark (`state.review.lastConsumedCommentAt`) so the same comment never re-fires across polls (regression net for RLF-59).
- Enforce architectural invariants with `no-restricted-imports` lint rules (warn → error across stages).
- Split `implement` into `implement` + `awaiting-ci`: post-implement CI polling does not consume a worker slot.
- Update the TUI to render phase and flow as two independent surfaces; `--json-output` `poll_done` events carry both `phase` and `flow`.
- Generate `ARCHITECTURE.md` at repo root from the registered features + router table.

## Stage breakdown

| #   | Stage                                                           | Effort |
| --- | --------------------------------------------------------------- | ------ |
| 0   | Characterization tests (regression net)                         | S      |
| 1   | Event bus + file consumer (additive)                            | M      |
| 2   | Pure detections + decouple phase from gate (fixes live bug)     | S      |
| 3   | Shared state schema + adopt invariant + PollContext tests       | M      |
| 4   | Shared capabilities extraction; lint rules as warn              | L      |
| 5   | Migrate features vertically                                     | L      |
| 6   | Router + runtime                                                | M      |
| 7   | Enforcement (lint → error) + assembly cleanup + ARCHITECTURE.md | S      |
| 8   | Split implement into implement + awaiting-ci                    | S      |

## Acceptance criteria

- All three stage-0 `.fails` tests are green: gated ticket + PR conflicted → conflict-fix wins; gated ticket + CI failing → ci-fix wins; approval persisted + tasks reset for conflict-fix → no re-gate.
- `bun run lint && bun run test` green; coverage threshold not lowered.
- `bunx openspec validate rlf-87-decouple-agent-into-capabilities-detecti --strict` passes.
- PostHog event-name preservation and `--json-output` golden-file tests pass (no schema drift).
- `~/.ralph/ralphy/logs/<date>.jsonl` contains a structured event for every capability call, detection result, router decision, and flow transition during a smoke run.
- Smoke: confirmation end-to-end on a real Linear ticket; conflict-fix recovers without re-gating; ci-fix recovers without re-gating; SIGINT mid-iteration exits cleanly.

See `design.md` for the full technical design, directory layout, contracts, and invariants.

## Steering

_Add steering notes here as the loop runs._
