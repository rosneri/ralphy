# agent-runtime-router — mention-revise precedence over conflicting PR status

## ADDED Requirements

### Requirement: Mention-revise wins over conflicting PR status in the same poll

The router MUST prefer `mention=revise` over `prStatus=conflicting`
when both arrive in the same poll for a change in
`awaiting-confirmation`.

When `route()` is called for a change that is parked in
`awaiting-confirmation` and the gathered `RouterSignals` for the poll
contain **both** `mention === "revise"` **and**
`prStatus === "conflicting"`, the returned `FlowAssignment` MUST
correspond to the `awaiting → revise via mention` row of the
precedence table (which opens the confirmation flow). The conflict
signal MUST be deferred — the router MUST NOT return the
conflict-fix flow assignment in this case, and the mention MUST NOT
be dropped silently.

The conflict signal is re-evaluated on subsequent polls after the
confirmation flow resolves; this requirement only governs the single
poll where both signals are observed simultaneously.

#### Scenario: mention=revise wins over prStatus=conflicting in the same poll

- **Given** a change is in `awaiting-confirmation`
- **And** the next poll's `RouterSignals` contain
  `mention = "revise"` **and** `prStatus = "conflicting"`
- **When** `route(signals)` is invoked
- **Then** the returned `FlowAssignment` opens the confirmation flow
  for the reviewer's revise comment (the `awaiting → revise via
mention` precedence row)
- **And** the returned assignment is **not** the conflict-fix flow
- **And** the mention signal is **not** dropped

#### Scenario: Conflict signal is deferred, not lost

- **Given** the previous scenario's poll resolved by opening the
  confirmation flow
- **And** the PR is still `conflicting` on a subsequent poll after the
  confirmation flow approves
- **When** `route(signals)` is invoked on that later poll
- **Then** the conflict-fix flow assignment is returned for that poll
  (the deferred conflict is now serviced)
