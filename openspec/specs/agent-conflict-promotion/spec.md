# agent-conflict-promotion Specification

## Purpose

TBD - created by archiving change rlf-81-auto-apply-ralph-conflict-label-when-fin. Update Purpose after archive.

## Requirements

### Requirement: Coordinator MUST promote finished in-progress tickets whose PR is conflicting

The coordinator MUST evaluate every in-progress ticket against a
promotion check on each poll, before queueing the ticket as a resume
spawn. The check considers the following conditions:

1. The ticket's openspec change has been archived locally — i.e. a
   directory entry exists under `openspec/changes/archive/` whose name
   ends in `-<changeName>` (where `<changeName>` is the value returned by
   `changeNameForIssue(issue)`); and
2. The agent has a `setConflicted` indicator configured; and
3. The ticket does NOT already carry every label that `setConflicted`
   would apply (case-insensitive); and
4. `checkPrStatus(issue)` resolves to a status of `"conflicted"`.

When all four conditions hold, the coordinator MUST:

- Apply `setConflicted` to the Linear issue.
- Skip queueing the ticket as a `resume` spawn this poll, so the next
  poll's `getConflicted` bucket picks it up via the conflict-fix flow.
- Post exactly one Linear comment per process run for that issue, in the
  form `⚠️ PR #<num> is conflicting with main — promoted to conflict-fix flow.`
  When the PR URL has no parseable `/pull/<num>` segment, the comment
  MUST fall back to `⚠️ PR <url> is conflicting with main — promoted to conflict-fix flow.`
- Emit a yellow log line summarising the promotion (issue identifier
  and PR URL).
- Emit the `agent_conflict_promoted` telemetry event with
  `{ issue_identifier, pr_url }`.

When `setConflicted` is not configured, OR `isChangeArchivedForIssue` is
not wired by the host, the promotion check MUST be a no-op (legacy
behavior: resume the ticket as before).

#### Scenario: finished in-progress ticket with CONFLICTING PR is promoted

- **Given** an in-progress ticket whose openspec change is archived
  locally
- **And** the ticket's PR exists with `mergeable === "CONFLICTING"`
- **And** the ticket does not already carry the `ralph:conflict` label
- **When** the coordinator runs `pollOnce`
- **Then** the `setConflicted` indicator is applied exactly once
- **And** a single Linear comment is posted that includes the PR number
  and the phrase "promoted to conflict-fix flow"
- **And** no `resume` worker is spawned for the ticket this poll

#### Scenario: promotion is idempotent across polls

- **Given** the ticket was promoted on the previous poll and Linear now
  reports the `ralph:conflict` label on the issue
- **When** the coordinator runs `pollOnce` and the ticket still appears
  in the `getInProgress` bucket
- **Then** `setConflicted` is NOT re-applied
- **And** no additional promotion comment is posted
- **And** the ticket is still skipped from the `resume` queue (the
  `getConflicted` bucket handles it)

#### Scenario: mergeable in-progress ticket resumes normally

- **Given** an in-progress ticket whose archived change is detected
- **And** `checkPrStatus` returns `"mergeable"`
- **When** the coordinator runs `pollOnce`
- **Then** `setConflicted` is NOT applied
- **And** the ticket is queued for a `resume` spawn as before

#### Scenario: in-progress ticket without an archived change resumes normally

- **Given** an in-progress ticket whose openspec change is still active
  (no archive entry)
- **When** the coordinator runs `pollOnce`
- **Then** the promotion check short-circuits without calling
  `checkPrStatus`
- **And** the ticket is queued for a `resume` spawn

### Requirement: Host MUST detect archived openspec changes from disk

The agent host MUST implement an isChangeArchivedForIssue callback that
resolves true when a directory entry under
`openspec/changes/archive/` (rooted at the worker's worktree if one is
registered for the change, else the project root) matches the issue's
change name.

The matcher MUST treat an entry as matching when its name equals
`<changeName>` exactly OR ends with the suffix `-<changeName>`, so that
openspec's default archive naming
(`<YYYY-MM-DD-HH-MM>-<changeName>`) is covered as well as any future
rename to a flat layout.

A missing `openspec/changes/archive/` directory MUST resolve to `false`
(no archived changes yet). All other filesystem errors MUST propagate so
the coordinator logs them and skips the promotion for that poll.

#### Scenario: archive entry matches by suffix

- **Given** the project contains
  `openspec/changes/archive/2026-05-20-12-34-rlf-81-foo/`
- **When** `isChangeArchivedForIssue` is called for an issue whose
  `changeName` is `rlf-81-foo`
- **Then** the function resolves `true`

#### Scenario: missing archive directory resolves false

- **Given** the project has never archived a change (no
  `openspec/changes/archive/` directory exists)
- **When** `isChangeArchivedForIssue` is called for any issue
- **Then** the function resolves `false` without throwing
