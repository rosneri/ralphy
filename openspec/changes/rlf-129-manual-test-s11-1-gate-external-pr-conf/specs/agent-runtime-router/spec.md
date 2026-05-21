# agent-runtime-router spec delta — RLF-129

## ADDED Requirements

### Requirement: Router resolves the 4-way collision in favour of the confirmation gate

The router MUST return `flowId: "confirmation"` with reason `"awaiting → confirm"` whenever a single `RouterSignals` value carries all four hostile signals at once: `awaiting === "awaiting"`, `bucket === "conflicted"` (or `prStatus === "conflicting"`), `prStatus === "ci-failing"`, and an externally-opened PR. The confirmation gate row (row 2 in `ROUTER_TABLE`) MUST beat `conflict-fix`, `ci-fix`, and every implement or mention row, so the RLF-87 bug class (implement or ci-fix firing through the gate) cannot silently reappear.

Once the gate clears (`awaiting === "none"`) while conflict and CI red
still hold, the next `route(signals)` call MUST return
`{ flowId: "conflict-fix" }` — `conflict-fix` beats `ci-fix` by row
order.

#### Scenario: 4-way collision resolves to confirmation

- **GIVEN** `RouterSignals` with `awaiting === "awaiting"`,
  `bucket === "conflicted"`, `prStatus === "ci-failing"`, and an
  externally-opened PR
- **WHEN** `route(signals)` is called
- **THEN** the result's `flowId` is `"confirmation"`
- **AND** the result's `reason` is `"awaiting → confirm"`
- **AND** neither `"conflict-fix"`, `"ci-fix"`, nor `"implement"` is
  returned

#### Scenario: After the gate clears, conflict beats CI red

- **GIVEN** `RouterSignals` with `awaiting === "none"`,
  `bucket === "conflicted"`, and `prStatus === "ci-failing"`
- **WHEN** `route(signals)` is called
- **THEN** the result's `flowId` is `"conflict-fix"`
- **AND** the result's `reason` is `"pr conflicting"`
