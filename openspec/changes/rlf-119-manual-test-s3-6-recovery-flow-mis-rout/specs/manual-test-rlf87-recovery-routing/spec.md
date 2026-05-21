# manual-test-rlf87-recovery-routing — S3.6 (confirm + automerge) reproduction

This capability codifies the manual-test mission for RLF-119: reproduce the RLF-87 bug where the confirmation gate intercepts a recovery (conflict-fix) flow and parks the ticket indefinitely, under the `confirm + automerge` engine variant.

## ADDED Requirements

### Requirement: A conflict-labeled ticket MUST preempt the confirmation gate during a recovery flow

When an in-flight Linear issue acquires the configured conflict label (default `ralph:conflict`) while the confirmation gate is otherwise active (`state.confirmation.confirmedAt == null`, opt-in label present, opt-out label absent), the coordinator MUST dispatch the ticket to the conflict-fix recovery path on the next poll. The confirmation feature MUST NOT claim the same id ahead of conflict-fix, and the gate watermark MUST NOT be required to proceed with the recovery action.

The expected end-state after the recovery worker completes is: the PR is rebased onto its base branch, the conflict label is cleared from the Linear issue, the GitHub `mergeStateStatus` returns to `CLEAN` (or `BLOCKED` for reasons unrelated to conflict), and — under `confirm + automerge` — auto-merge resolves the PR without any new human signal.

#### Scenario: S3.6 confirm + automerge — conflict-fix preempts the gate

- **Given** the manual-test mission is run against `NeriRos/ralphy-rlf87-test` with the `claude haiku` engine
- **And** the agent is configured in `confirm + automerge` mode with the standard opt-in label
- **And** an in-flight Linear issue has an open PR previously created by the agent
- **And** `state.confirmation.askedAt` is set, `state.confirmation.confirmedAt` is `null`, `state.confirmation.rounds == 0`
- **And** `tasks.md` for the change still contains at least one unchecked item
- **When** a conflicting commit is pushed to `main` such that `gh pr view` reports `mergeStateStatus: DIRTY`
- **And** the operator applies the `ralph:conflict` label to the Linear issue
- **And** the operator toggles confirmation mode ON between polls so `gateActive()` would otherwise return `true`
- **And** the coordinator runs the next two polls
- **Then** the agent log contains a `queued (conflict-fix)` line for the change on the first post-trigger poll
- **And** the agent log does NOT contain `awaiting: 1` for the same id on that poll
- **And** a recovery worker rebases the PR onto `main` and clears the `ralph:conflict` label
- **And** within one polling interval after the label is cleared, GitHub auto-merge fires and the PR is merged
- **And** `state.confirmation.confirmedAt` remains `null` throughout (the recovery path did not require a human watermark)

### Requirement: The S3.6 reproduction MUST be observable from the agent log and PR state without inspecting in-memory coordinator state

The manual test MUST be scoreable purely from artifacts the operator can collect after the run: the on-disk agent JSON log, the Linear issue labels, and the GitHub PR `mergeStateStatus` and merge state. No additional instrumentation, debugger attach, or coordinator-internal dump is permitted as a pass/fail signal.

#### Scenario: regression signature — gate intercepts conflict-fix (bug present)

- **Given** the S3.6 reproduction is executed against an agent build that still contains the RLF-87 bug
- **When** the operator completes the setup steps (push conflicting commit, apply `ralph:conflict`, toggle confirmation mode ON)
- **And** the coordinator runs at least two further polls
- **Then** the agent log shows `awaiting: 1` for the change on every poll after the trigger
- **And** the agent log contains no `queued (conflict-fix)` line for the same id
- **And** `gh pr view` continues to report the `ralph:conflict` label on the Linear issue and `mergeStateStatus: DIRTY` on the PR
- **And** the PR is never auto-merged
- **And** the mission is recorded as **FAIL** (bug reproduced) against the `manual-test-rlf87-automerge` and `manual-test-rlf87-confirm` Linear labels

#### Scenario: pass signature — recovery completes without human signal (bug fixed)

- **Given** the S3.6 reproduction is executed against an agent build where RLF-87 is fixed
- **When** the operator completes the same setup steps
- **Then** the on-disk agent log contains exactly one `queued (conflict-fix)` line for the change within the first two polls after the trigger
- **And** the `ralph:conflict` label disappears from the Linear issue within the same window
- **And** the GitHub PR transitions to merged with `mergeStateStatus` no longer `DIRTY`
- **And** the operator did not apply the approval indicator at any point during the run
- **And** the mission is recorded as **PASS** against the `manual-test-rlf87-automerge` and `manual-test-rlf87-confirm` Linear labels
