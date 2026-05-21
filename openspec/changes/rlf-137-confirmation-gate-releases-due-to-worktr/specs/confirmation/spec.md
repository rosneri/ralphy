# Confirmation gate worktree path resolution

## MODIFIED Requirements

### Requirement: Confirmation gate locates per-issue tasks.md using the canonical worktree directory name

When `processAwaitingForIssue` evaluates whether an issue is still awaiting confirmation, it MUST resolve the change's working directory using the same naming scheme that the worker uses to create the worktree on disk. That scheme is the lowercased Linear identifier (e.g. `rlf-101`), exposed via a single helper `worktreeDirNameForIssue(issue)`.

The resolution order is:

1. If `cwdOf(changeName)` returns a path, use it.
2. If `useWorktree` is false, use `projectRoot`.
3. If `<worktreesDir>/<worktreeDirNameForIssue(issue)>/openspec/changes/<changeName>/tasks.md` exists, use `<worktreesDir>/<worktreeDirNameForIssue(issue)>` (canonical).
4. Else if `<worktreesDir>/<changeName>/openspec/changes/<changeName>/tasks.md` exists, use `<worktreesDir>/<changeName>` (legacy fallback for in-flight worktrees created before this change).
5. Otherwise fall back to `projectRoot`.

#### Scenario: Worktree directory uses short identifier and openspec change uses full slug

- **GIVEN** an issue with identifier `RLF-101` and changeName `rlf-101-manual-test-b-add-add-a-b-confirmation`
- **AND** a worktree at `<worktreesDir>/rlf-101` containing `openspec/changes/rlf-101-manual-test-b-add-add-a-b-confirmation/tasks.md` with at least one unchecked task
- **AND** the confirmation gate is active for that issue (label-based or persisted askedAt without confirmedAt)
- **WHEN** `processAwaitingForIssue` runs
- **THEN** the gate MUST stay claimed (return `true`, add the changeName to `awaitingChangeSet`, call `reapForAwaiting`)
- **AND** MUST NOT emit `confirmation detect released — tasks-empty`

#### Scenario: Worker and gate share a single source of truth for the worktree directory name

- **GIVEN** the wire/prepare path creates a worktree for an issue
- **WHEN** the directory name is computed
- **THEN** it MUST come from `worktreeDirNameForIssue(issue)` rather than an inline `issue.identifier.toLowerCase()` call
- **AND** the confirmation gate MUST resolve the same directory name from the same helper
