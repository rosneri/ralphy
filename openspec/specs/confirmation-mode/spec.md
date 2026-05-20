# confirmation-mode Specification

## Purpose

TBD - created by archiving change rlf-78-confirmation-mode-human-gate-between-tas. Update Purpose after archive.

## Requirements

### Requirement: A confirmation-gated change MUST pause between `tasks` and `implement` until an approval signal is observed

The system MUST treat a change as _confirmation-gated_ when
`linear.confirmationMode.enabled` is true and the ticket does NOT carry
the configured `optOutLabel`. A gated change whose `proposal.md`,
`design.md`, and `tasks.md` are all filled in (i.e. would otherwise
derive to `implement`) MUST instead derive to the new
`awaiting-confirmation` phase until an approval signal
is observed via the `getApproved` indicator, or until the operator
clears the gate by adding the `optOutLabel`.

The agent MUST NOT spawn or continue an `implement` worker for a change
in `awaiting-confirmation`. It MUST NOT count toward
`concurrency` slots, and it MUST NOT appear in `workers.active` or
`workers.queue`.

When the approval signal is observed, the agent MUST fire the
`clearApproved` indicator (if configured), set
`state.confirmation.confirmedAt` to the current ISO timestamp, and let
the next poll's deriver return `implement`.

#### Scenario: gated change with planning artifacts but no approval signal sits at the gate

- **Given** `linear.confirmationMode.enabled: true`
- **And** an issue without the `ralph:auto-approve` label
- **And** `proposal.md`, `design.md`, and `tasks.md` all exist with
  unchecked items
- **And** no `ralph:approved` label is present
- **When** the coordinator polls
- **Then** `deriveOpenSpecPhase` returns `awaiting-confirmation`
- **And** the ticket is routed into `buckets.awaiting`
- **And** no `implement` worker is spawned for this change
- **And** the ticket does not appear in `workers.active` or
  `workers.queue`

#### Scenario: approval signal advances the change to implement

- **Given** a change in `awaiting-confirmation`
- **When** the `ralph:approved` label is applied and the coordinator
  polls again
- **Then** `getApproved` matches
- **And** `clearApproved` fires exactly once (the label is removed)
- **And** `state.confirmation.confirmedAt` is set to a non-null
  timestamp
- **And** the next phase derivation returns `implement`

#### Scenario: opt-out label bypasses the gate

- **Given** `linear.confirmationMode.enabled: true`
- **And** an issue carrying the `ralph:auto-approve` label
- **And** planning artifacts complete
- **When** the coordinator polls
- **Then** `deriveOpenSpecPhase` returns `implement` (no gating)

#### Scenario: confirmationMode disabled preserves existing behaviour

- **Given** `linear.confirmationMode.enabled: false` (the default)
- **And** any ticket with planning artifacts complete
- **When** the coordinator polls
- **Then** `deriveOpenSpecPhase` returns `implement`
- **And** the ticket is enqueued exactly as before this change

### Requirement: The gate MUST NOT block the queue

Tickets sitting in `awaiting-confirmation` MUST be tracked in a separate
`awaiting` bucket and MUST NOT consume `concurrency` worker slots. A
project with `concurrency: 1`, one gated ticket, and one fresh `Todo`
ticket MUST pick up the fresh ticket and run it to completion while the
gated ticket waits.

#### Scenario: gated ticket does not starve a fresh Todo ticket at concurrency 1

- **Given** `concurrency: 1`
- **And** ticket A is in `awaiting-confirmation`
- **And** ticket B is fresh in `Todo` and not gated
- **When** the coordinator polls
- **Then** ticket B is enqueued and a worker begins on it
- **And** ticket A is reported in `buckets.awaiting`
- **And** ticket A is NOT counted in `workers.active` or
  `workers.queue`

### Requirement: A `@ralphy revise: <reason>` comment MUST loop the change back to `design`

The agent MUST treat a comment matching `@ralphy revise: <reason>` on a
gated change as a revise signal. The agent MUST consume the comment, write `<reason>` to
steering, reset `state.confirmation.confirmedAt` to `null`, bump
`state.confirmation.rounds` by one, and cause the next phase derivation
to return `design` so the agent re-plans with the new steering.

The agent MUST NOT process more than one revise comment per round; any
surplus revise comments are either deferred to the next round or merged
into the steering text.

When `state.confirmation.rounds` reaches the configured
`maxConfirmationRounds`, the agent MUST post a one-shot "max rounds
reached" comment, apply a `ralph:stuck` label, and skip the ticket on
subsequent polls until that label is cleared. The agent MUST NOT
auto-approve.

#### Scenario: revise comment loops back to design

- **Given** a change in `awaiting-confirmation`, round 0
- **When** an operator posts `@ralphy revise: tighten the scope`
- **And** the coordinator polls
- **Then** `state.confirmation.rounds` becomes `1`
- **And** `state.confirmation.confirmedAt` is `null`
- **And** steering contains `tighten the scope`
- **And** the next phase derivation returns `design`

#### Scenario: round cap halts the gate

- **Given** a change in `awaiting-confirmation` with
  `state.confirmation.rounds` equal to `maxConfirmationRounds`
- **When** the coordinator inspects the ticket
- **Then** a one-shot `max rounds reached` comment is posted
- **And** the `ralph:stuck` label is applied
- **And** the ticket is skipped on subsequent polls until
  `ralph:stuck` is cleared
- **And** no automatic approval occurs

### Requirement: PR creation is suppressed while a change is gated

`createPrOnSuccess` MUST NOT fire for any change whose current phase is
`awaiting-confirmation`. This is a defence-in-depth guard; the worker
is also expected to be reaped before any code exists, but the
suppression MUST hold even if a stale branch is present.

`syncTasksToComment` and `syncSpecsAsAttachments` MUST continue running
while gated, so the reviewer always sees current planning artifacts and
human edits to `tasks.md` still flow into Linear.

#### Scenario: gated change does not open a PR

- **Given** a change in `awaiting-confirmation`
- **When** the wire layer runs its post-iteration hooks
- **Then** `createPrOnSuccess` is not invoked for this change
- **And** `syncTasksToComment` is still invoked
- **And** `syncSpecsAsAttachments` is still invoked

### Requirement: Gate state MUST be surfaced in the TUI and `--json-output`

The Ink TUI MUST render a `[GATE]` marker on change-cards in
`awaiting-confirmation`, including the current round and time since the
gate was asked. The poll-status block MUST include an `awaiting N`
count.

`--json-output` MUST add a `buckets.awaiting` field to every
`poll_done` event, and MUST emit a one-shot `awaiting_confirmation`
event per round-entry (idempotent — not re-emitted on subsequent polls
of the same round).

#### Scenario: poll_done payload carries the awaiting count

- **Given** a project with 2 changes in `awaiting-confirmation`
- **When** a poll completes and `--json-output` is enabled
- **Then** the emitted `poll_done` event contains `"buckets":{...,
"awaiting": 2, ...}`

#### Scenario: awaiting_confirmation event fires once per round

- **Given** a change just entering `awaiting-confirmation` at round 0
- **When** the gate is first observed
- **Then** exactly one
  `{"type":"awaiting_confirmation","changeName":"...","round":0}`
  event is emitted
- **And** subsequent polls in the same round do not re-emit it
