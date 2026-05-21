# Design for RLF-119

## Scope

This is a **spec-only** change. It captures the S3.6 (`confirm + automerge` variant) manual-test reproduction for the RLF-87 recovery-routing bug as an OpenSpec capability. No source code under `apps/` or `packages/` is touched.

## Files to touch

- `openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/proposal.md` — fill `## Why` and `## What Changes` sections to satisfy the validator.
- `openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/design.md` — this file.
- `openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/specs/manual-test-rlf87-recovery-routing/spec.md` — new capability spec with ADDED requirements.
- `openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/tasks.md` — append `## Implementation` checklist.

## Capability shape

Capability name: `manual-test-rlf87-recovery-routing`.

The spec describes the manual-test mission, not runtime code, so the requirements are framed as "a manual run of the S3.6 scenario MUST observe X" rather than "the agent MUST do X internally." This matches the pattern used by other RLF-87 sub-tickets that document reproduction missions.

## Reproduction scenario (S3.6 — confirm + automerge)

The relevant agent code paths (for reviewer context, not modification):

- Confirmation gate watermark: `packages/core/src/detections/gate.ts` — `gateActive()`. Gate is active while `persistedConfirmation.confirmedAt` is null.
- Awaiting claim: `apps/agent/src/features/confirmation/awaiting.ts` — `processAwaitingForIssue()`. Returns `true` to claim a ticket; the coordinator then excludes the id from other enqueue branches via `eligible(id)`.
- Conflict fetch: `apps/agent/src/runtime/coordinator.ts` — `fetchConflicted()` pulls issues labeled `ralph:conflict` and queues them with the `conflict-fix` trigger (lines ~340–455). Because the coordinator runs the registry walk before the conflict-fix enqueue and shares one `claimedIds` set, a confirmation claim on the same id silently suppresses the conflict-fix branch.

The mission runs against `NeriRos/ralphy-rlf87-test` with the `claude haiku` engine and the engine config in `confirm + automerge` mode. The operator:

1. Lets the agent open a PR in the normal confirm-gated path.
2. Pushes a conflicting commit to `main` so the PR cannot fast-forward.
3. Applies `ralph:conflict` to the in-flight Linear issue.
4. Toggles confirmation mode ON between polls (so `gateActive()` returns true on the next poll).
5. Observes the next two polls.

### Expected (after RLF-87 is fixed)

- Conflict-fix preempts the gate; the worker rebases the PR onto `main`, clears `ralph:conflict`, and auto-merge fires.
- The agent log shows `queued (conflict-fix)` for the change on the same poll the confirmation feature would otherwise have claimed it.
- `buckets.awaiting` does not include the ticket after the conflict-fix worker exits cleanly.

### Regression signature (current — bug present)

- The agent log shows `awaiting: 1` for the change on every poll after step 4, with no `queued (conflict-fix)` line for the same id.
- The PR retains `ralph:conflict` indefinitely; auto-merge never fires.
- `state.confirmation.confirmedAt` stays `null`, `state.confirmation.askedAt` is set.

## Data flow

```
Linear poll → fetchInProgress(ids) ─┐
                                    ├─→ registry.walk → confirmation.detect (claims id) ──→ buckets.awaiting++
Linear poll → fetchConflicted(ids) ─┘                                                       ↑
                                    └─→ eligible(id) := !claimedIds.has(id) ── EXCLUDES ────┘
                                            ↓
                                            conflict-fix enqueue branch is SKIPPED
```

The bug lives in the ordering+sharing of `claimedIds`: confirmation claims first, conflict-fix loses. The spec encodes the inverse invariant.

## Edge cases captured in the spec

- The opt-out label is absent (gate would otherwise short-circuit).
- The opt-in label requirement is satisfied (gate is genuinely active).
- `tasks.md` still has unchecked items (so `processAwaitingForIssue` does not bail on `tasks-empty`).
- A conflicting commit is on `main` such that `gh pr view` reports `mergeStateStatus: DIRTY`.

## Validation

Run `bunx openspec validate rlf-119-manual-test-s3-6-recovery-flow-mis-rout` after writing the spec delta. The capability is new, so the validator only needs ADDED requirements with at least one `#### Scenario:` block each.
