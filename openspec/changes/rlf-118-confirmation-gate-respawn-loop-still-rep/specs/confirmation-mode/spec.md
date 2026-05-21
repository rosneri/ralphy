# confirmation-mode — claim stability across polls

## ADDED Requirements

### Requirement: `processAwaitingForIssue` MUST hold the confirmation claim across polls until a human signal arrives

When the confirmation feature has reaped a worker for awaiting-confirmation and persisted `state.confirmation.askedAt`, every subsequent poll MUST continue to claim the same ticket from the coordinator's registry walk until one of the following human signals is observed:

- the configured `getApproved` indicator matches the ticket (label / status / project / attachment), OR
- a comment matching `<mentionHandle> revise: <reason>` newer than the watermark (`state.confirmation.lastReviseConsumedAt ?? state.confirmation.askedAt`) is fetched from Linear, OR
- `state.confirmation.rounds >= maxConfirmationRounds` (in which case the ticket flips to the stuck branch — still claimed).

In particular, `processAwaitingForIssue` MUST NOT return `false` on a later poll when the persisted state still has `confirmedAt: null`, no approval marker is present, no new revise comment is found, and the change's `tasks.md` still contains unchecked items.

When `processAwaitingForIssue` throws unexpectedly, the feature MUST log the error with the issue identifier and the originating exception message, AND MUST return `true` (i.e. continue to claim the ticket) so the legacy resume branch does not respawn the reaped worker. The next poll re-runs `detect` cleanly.

Every `return false` path inside `processAwaitingForIssue` MUST emit a one-line diagnostic log naming the branch (e.g. `gate-cleared`, `tasks-empty`, `outcome=approved`, `outcome=revised`, `threw: <msg>`) through the existing `onLog` channel.

#### Scenario: second-poll resume preserves the claim when no human signal has arrived

- **Given** a change in `awaiting-confirmation` with `state.confirmation.askedAt` set, `confirmedAt: null`, `rounds: 0`
- **And** the ticket has no approval indicator and no `@ralphy revise: <reason>` comment newer than `askedAt`
- **And** `tasks.md` still contains at least one unchecked item
- **When** the coordinator polls and dispatches the issue to the confirmation feature's `detect`
- **Then** `processAwaitingForIssue` returns `true`
- **And** the coordinator's `buckets.awaiting` count includes this ticket
- **And** the ticket is NOT enqueued under the legacy `resume` trigger
- **And** no new worker is spawned for the change

#### Scenario: thrown error inside detect preserves the claim and is logged

- **Given** a confirmation-gated ticket whose `detect` invocation raises an exception (e.g. a transient Linear comment-fetch failure not already caught internally)
- **When** the coordinator polls
- **Then** the agent log contains a line of the form `! confirmation detect threw for <identifier>: <message>`
- **And** `processAwaitingForIssue` returns `true`
- **And** the legacy `resume` branch does NOT enqueue the ticket this poll

#### Scenario: gate clears (approval marker applied) releases the claim with a logged reason

- **Given** a confirmation-gated ticket
- **When** an operator applies the configured approval marker and the coordinator polls
- **Then** `processAwaitingForIssue` returns `false`
- **And** the agent log contains a one-line reason `gate-cleared` (or equivalent) for the released claim
