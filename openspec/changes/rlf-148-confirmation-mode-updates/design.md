# Design for RLF-148

## Files touched

- `packages/workflow/src/schema.ts` — add `setAwaitingConfirmation`
  and `clearAwaitingConfirmation` to `IndicatorsSchema`. Both are
  `SetIndicatorSchema` (marker or marker[]). Apply the same
  label-only `superRefine` to `clearAwaitingConfirmation` that
  `clearApproved` already gets.
- `packages/types/src/types.ts` — extend the `Indicators` type to
  expose the two new optional fields.
- `packages/workflow/src/default.ts` — add commented-out examples
  under the existing "Confirmation gate" block.
- `apps/agent/src/features/confirmation/state.ts` — extend
  `ConfirmationState` with `awaitingMarkerAppliedAt: string | null`.
  Default to `null`. `readConfirmationState` back-fills the field
  for older state files.
- `apps/agent/src/features/confirmation/awaiting.ts`
  - On first observation of an active gate (before posting the
    plan-ready comment), if `setAwaitingConfirmation` is configured
    and `awaitingMarkerAppliedAt` is null, apply the indicator and
    persist the timestamp.
  - On every "release" path (gate-cleared, tasks-empty,
    proposal/design stub, outcome=approved, outcome=revised), if
    `clearAwaitingConfirmation` is configured AND
    `awaitingMarkerAppliedAt` is set, apply the clear indicator and
    null the timestamp.
  - Rewrite `postPlanReadyCommentOnce`'s body to enumerate the
    configured approval marker(s) from
    `cfg.linear.indicators.getApproved` and to spell out the revise
    syntax. The string itself is hardcoded; only the marker text is
    interpolated. If `getApproved` is not configured, fall back to a
    generic "ask the operator to approve" sentence.
- `apps/agent/src/features/confirmation/inspect.ts` — no behavior
  change here; awaiting/clear application stays in `awaiting.ts`
  (where `applyIndicator` is already wired).
- Tests:
  - `packages/workflow/src/__tests__/` schema tests — accept/reject
    the new indicator fields, enforce label-only on the clear.
  - `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts`
    — assert `setAwaitingConfirmation` fires exactly once across
    multiple polls of the same parked ticket; assert
    `clearAwaitingConfirmation` fires on every release path.
  - Plan-ready comment text assertion: includes the configured
    marker (e.g. `ralph:approved`) and the revise syntax.

## Data flow

```
poll → processAwaitingForIssue
  ├─ gate inactive? → release: applyClear + null ts → return false
  ├─ tasks empty / stub artifacts? → release: applyClear → return false
  ├─ gate active, first sighting →
  │     apply setAwaitingConfirmation (if not yet) → set ts
  │     postPlanReadyCommentOnce (existing) → set askedAt
  ├─ inspectAwaitingTicket → approved/revised → release: applyClear
  └─ stay-awaiting → onAwaitingTicket → return true
```

## Edge cases

- Operator enables `setAwaitingConfirmation` mid-flight after a ticket
  already parked: `awaitingMarkerAppliedAt` is null, so next poll
  applies and stamps.
- `applyIndicator` raises (Linear down): log yellow warning, do NOT
  stamp the timestamp, retry next poll.
- `clearAwaitingConfirmation` raises on release: log yellow warning,
  still null the timestamp — next active gate for the same change
  re-applies. Mirrors `clearApproved`'s defence-in-depth.
- Rebound (approve → revise → approve again): revise release clears
  the marker. When the gate re-activates the marker is reapplied
  because the timestamp was reset.
- Mention handle / approval marker values reach the plan-ready
  comment via the existing `cfg` parameter — no new wiring.
