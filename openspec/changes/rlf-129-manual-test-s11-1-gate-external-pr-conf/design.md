# Design for RLF-129

## Context

RLF-87 was the bug class where `implement` or `ci-fix` fired through
an active confirmation gate. RLF-95 collapsed feature-specific
branching into a pure precedence table (`apps/agent/src/runtime/router.ts`)
whose row order is the single source of truth. S11.1 is the 4-way
collision case: same poll, same ticket, four hostile signals all
firing.

## Goal

Pin the router's behaviour for the 4-way collision via a deterministic
unit test, and codify the requirement as a spec delta so future
refactors of `ROUTER_TABLE` cannot silently reintroduce RLF-87.

## Files touched

- `apps/agent/src/runtime/__tests__/router.test.ts` — add two `it()`
  cases:
  1. "4-way collision: gate wins over conflict + ci-failing + external PR"
  2. "after gate clears, conflict-fix beats ci-fix"
- `openspec/changes/rlf-129-.../specs/agent-runtime-router/spec.md` —
  new spec delta with ADDED requirement and two scenarios.

No production source under `apps/agent/src/runtime/` needs to change:
the current row order already satisfies the requirement. The mission
is to lock the existing behaviour with a regression test.

## Data flow

`route(signals)` is pure. The test constructs a `RouterSignals` value
directly (via the existing `sig()` helper in the test file) and asserts
on the returned `FlowAssignment`. No I/O, no mocks, no async.

## Edge cases

- The `pr.author !== "ralpy"` ("externally-opened PR") signal is not a
  field on `RouterSignals` in the current router — externality is
  reflected indirectly through `prStatus` and `bucket`. The test
  therefore exercises the observable router inputs
  (`awaiting`, `bucket`, `prStatus`); the "external PR" framing from
  the Linear ticket is satisfied as long as the gate row wins.
- `bucket === "conflicted"` is set in addition to
  `prStatus === "ci-failing"` so the test pins both conflict-detection
  paths (`prStatus === "conflicting"` OR `bucket === "conflicted"`)
  against the gate.
- `mention` is left at `"none"` so the mention catch-all is not
  exercised; the gate row must still win regardless of mention state.

## Out of scope

- No router source changes.
- No new runtime behaviour. Manual-test missions verify existing
  behaviour; they don't add features.
- No changes to `coordinator.ts`, `flow-runner.ts`, or `poll.ts`.
