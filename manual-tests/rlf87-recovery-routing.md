# Manual Test — RLF-87 recovery routing (S3.6 confirm + automerge)

Operator runbook for the RLF-119 mission. Captures the executable steps that
correspond to the OpenSpec capability
`openspec/changes/rlf-119-manual-test-s3-6-recovery-flow-mis-rout/specs/manual-test-rlf87-recovery-routing/spec.md`.

Use this file when running the reproduction against
`NeriRos/ralphy-rlf87-test`. It is the artifact the operator follows; the
OpenSpec doc is the contract the run is scored against.

## Setup

- Engine: `claude haiku`.
- Mode: `confirm + automerge` (opt-in label present, opt-out label absent,
  conflict label default `ralph:conflict`).
- Target repo: `NeriRos/ralphy-rlf87-test`.
- Pre-state: an in-flight Linear issue with an open PR previously created by
  the agent, `state.confirmation.askedAt` set, `state.confirmation.confirmedAt
== null`, `state.confirmation.rounds == 0`, and `tasks.md` for the change
  still has at least one unchecked item.

## Steps

1. Let the agent open a PR in the normal confirm-gated path. Wait for the
   confirmation gate to be active.
2. Push a conflicting commit to `main` so the PR cannot fast-forward. Confirm
   `gh pr view --json mergeStateStatus` reports `DIRTY`.
3. Apply the `ralph:conflict` label to the in-flight Linear issue.
4. Toggle confirmation mode ON between polls so that `gateActive()` would
   otherwise return `true` on the next poll.
5. Observe the next two coordinator polls.

## Scoring

Collect these artifacts after the run — they are the only allowed pass/fail
signals (no debugger attach, no coordinator-internal dump):

- The on-disk agent JSON log for the polling window.
- The Linear issue labels (via `linear` CLI or the API).
- `gh pr view --json mergeStateStatus,state,mergedAt` for the PR.

### PASS (bug fixed)

- The agent log contains exactly one `queued (conflict-fix)` line for the
  change within the first two polls after the trigger.
- The `ralph:conflict` label disappears from the Linear issue within the same
  window.
- The PR transitions to `MERGED` and `mergeStateStatus` is no longer `DIRTY`.
- `state.confirmation.confirmedAt` remained `null` throughout.

Record the result against the `manual-test-rlf87-automerge` and
`manual-test-rlf87-confirm` Linear labels.

### FAIL (bug reproduced — current state)

- The agent log shows `awaiting: 1` for the change on every poll after the
  trigger.
- The agent log contains no `queued (conflict-fix)` line for the same id.
- `gh pr view` continues to report the `ralph:conflict` label and
  `mergeStateStatus: DIRTY`.
- The PR is never auto-merged.

Record FAIL against the same two Linear labels.

## Why this is wired through the coordinator

Reviewer reference — do not modify as part of this mission:

- Confirmation gate watermark: `packages/core/src/detections/gate.ts` —
  `gateActive()`.
- Awaiting claim: `apps/agent/src/features/confirmation/awaiting.ts` —
  `processAwaitingForIssue()` returns `true` to claim the id, after which the
  coordinator excludes it via `eligible(id)`.
- Conflict fetch: `apps/agent/src/runtime/coordinator.ts` — `fetchConflicted()`
  pulls issues labeled `ralph:conflict` and queues them with the
  `conflict-fix` trigger. The confirmation claim runs first and shares one
  `claimedIds` set with the conflict-fix branch, so the recovery enqueue is
  silently suppressed until the watermark clears. The S3.6 reproduction
  exercises exactly this ordering.
