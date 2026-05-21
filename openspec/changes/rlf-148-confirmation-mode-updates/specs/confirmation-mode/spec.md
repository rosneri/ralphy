# Confirmation mode — waiting indicator + explanatory comment

## ADDED Requirements

### Requirement: The gate MUST apply `setAwaitingConfirmation` when a ticket first parks in `awaiting-confirmation`

The coordinator MUST apply the configured `setAwaitingConfirmation` indicator (if any) to the Linear issue exactly once per gate-entry when a change enters the `awaiting-confirmation` phase. Application MUST be idempotent across polls: the timestamp `state.confirmation.awaitingMarkerAppliedAt` records the moment of successful application and suppresses re-apply on subsequent polls of the same gate-entry.

If `setAwaitingConfirmation` is not configured, the gate MUST behave
exactly as before this change (no indicator application).

#### Scenario: setAwaitingConfirmation fires once per gate-entry

- **Given** `linear.indicators.setAwaitingConfirmation` is configured
  as `{ type: "label", value: "ralph:awaiting" }`
- **And** a change just transitioned into `awaiting-confirmation`
- **When** the coordinator polls
- **Then** `applyIndicator(setAwaitingConfirmation)` is invoked exactly
  once
- **And** `state.confirmation.awaitingMarkerAppliedAt` is set to the
  current ISO timestamp
- **And** subsequent polls of the same gate-entry do NOT call
  `applyIndicator` again

#### Scenario: setAwaitingConfirmation unset preserves prior behavior

- **Given** `linear.indicators.setAwaitingConfirmation` is not
  configured
- **When** a change enters `awaiting-confirmation`
- **Then** no awaiting-indicator application occurs
- **And** the existing plan-ready comment is still posted

### Requirement: The gate MUST apply `clearAwaitingConfirmation` on every release path

The agent MUST apply the configured `clearAwaitingConfirmation` indicator (if any) and reset `awaitingMarkerAppliedAt` to `null` whenever the gate releases a ticket (reasons: `gate-cleared`, `tasks-empty`, proposal/design stubbed, outcome `approved`, outcome `revised`) and `state.confirmation.awaitingMarkerAppliedAt` is currently set.

`clearAwaitingConfirmation` markers MUST be label-typed; the schema
MUST reject status/project/attachment markers (status removal is not
supported by Linear).

#### Scenario: approval release clears the awaiting marker

- **Given** the gate previously stamped `awaitingMarkerAppliedAt`
- **And** `clearAwaitingConfirmation` is configured as
  `{ type: "label", value: "ralph:awaiting" }`
- **When** the reviewer applies the approval marker and the
  coordinator polls
- **Then** the gate releases with outcome `approved`
- **And** `applyIndicator(clearAwaitingConfirmation)` is invoked once
- **And** `state.confirmation.awaitingMarkerAppliedAt` becomes `null`

#### Scenario: revise release clears the awaiting marker

- **Given** the gate previously stamped `awaitingMarkerAppliedAt`
- **When** the reviewer posts `@ralphy revise: <reason>` and the
  coordinator polls
- **Then** the gate releases with outcome `revised`
- **And** `applyIndicator(clearAwaitingConfirmation)` is invoked once
- **And** `state.confirmation.awaitingMarkerAppliedAt` becomes `null`

### Requirement: The plan-ready comment body is hardcoded but interpolates the configured approval marker(s)

The "📋 Ralphy plan ready" comment body MUST be hardcoded in source
(NOT loaded from `WORKFLOW.md` and NOT exposed as a templating
surface). It MUST interpolate the configured `getApproved` marker(s)
and the configured `mentionHandle` so the reviewer sees concrete
approve / revise instructions without consulting documentation.

If `getApproved` is not configured, the comment MUST fall back to a
generic "ask the operator to approve" sentence (so the gate is still
self-explanatory in projects that approve manually).

#### Scenario: plan-ready comment enumerates the configured approval marker

- **Given** `linear.indicators.getApproved.filter` contains
  `{ type: "label", value: "ralph:approved" }`
- **And** `linear.mentionHandle` is `@ralphy`
- **When** a change first enters `awaiting-confirmation`
- **Then** exactly one Linear comment is posted on the issue
- **And** its body contains the literal string `ralph:approved`
- **And** its body contains the literal string `@ralphy revise:`
- **And** the body is NOT sourced from any field in `WORKFLOW.md`

#### Scenario: plan-ready comment without getApproved falls back to a generic instruction

- **Given** `linear.indicators.getApproved` is not configured
- **When** a change first enters `awaiting-confirmation`
- **Then** the posted comment body contains a generic approve
  instruction (e.g. "ask the operator to approve")
- **And** the body still contains the `@ralphy revise:` syntax
