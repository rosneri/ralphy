# agent-worktree — fail loudly when worktree creation fails

## ADDED Requirements

### Requirement: Fail loudly when worktree creation fails

The agent MUST NOT execute a worker in the project root when worktree mode is
enabled and worktree creation fails. Instead, the setup step MUST propagate
the error so the coordinator skips the issue for the current poll cycle and
retries on the next poll. The failure MUST be logged in red so operators see
it in the live log stream (today it is logged yellow and silently swallowed).

When `useWorktree` is unset or false, the previous behaviour is preserved:
`setupWorktree()` returns with `workerCwd = projectRoot` and no worktree is
created.

#### Scenario: worktree creation throws while useWorktree is true

- **Given** `useWorktree: true` and a `GitRunner` whose `run()` rejects when called by `createWorktree()`
- **When** `setupWorktree()` runs for an issue (via `prepare()`)
- **Then** the call rejects with the underlying error
- **And** no scaffold directories are created under `projectRoot`
- **And** the failure is logged in red

#### Scenario: useWorktree is false — fallback path preserved

- **Given** `useWorktree: false`
- **When** `setupWorktree()` runs for an issue
- **Then** it returns `workerCwd = projectRoot` without invoking `createWorktree()`
