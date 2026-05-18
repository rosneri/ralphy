# linear-tasks-comment — refresh sticky tasks comment every poll

## ADDED Requirements

### Requirement: The sticky tasks comment MUST refresh every poll regardless of progress-comment configuration

`AgentCoordinator.pollOnce` MUST invoke the `syncTasks` hook once per active
worker per poll whenever the hook is wired, independent of the
`postComments` flag and the `commentEveryIterations` setting. The hook is
the user-facing source of truth for mission progress and MUST update even
when the noisy `🔄 Ralph progress update` comment is suppressed.

The coordinator MUST skip the sync call for a worker when the worker's
current iteration count (as reported by `getIterationCount`) has not
advanced since the previous successful sync, to avoid pointless Linear API
churn between iterations.

If `getIterationCount` or `syncTasks` throws, the coordinator MUST log a
yellow warning and MUST NOT advance the worker's `lastSyncedIteration`
sentinel, so the next poll retries the sync.

#### Scenario: postComments: false still refreshes the tasks comment

- **Given** an active worker, `postComments: false`, and a wired `syncTasks`
  hook
- **And** `getIterationCount` returns `3` on this poll where it returned
  `1` on the previous poll
- **When** `pollOnce` runs
- **Then** `syncTasks(worker, 3)` is called exactly once
- **And** no `🔄 Ralph progress update` comment is posted

#### Scenario: commentEveryIterations=0 still refreshes the tasks comment

- **Given** an active worker, `commentEveryIterations: 0`, and a wired
  `syncTasks` hook
- **And** `getIterationCount` returns `5`
- **When** `pollOnce` runs
- **Then** `syncTasks(worker, 5)` is called
- **And** no `🔄 Ralph progress update` comment is posted

#### Scenario: unchanged iteration count skips the sync call

- **Given** an active worker that was last synced at iteration `7`
- **And** `getIterationCount` returns `7` again this poll
- **When** `pollOnce` runs
- **Then** `syncTasks` is NOT invoked for this worker this poll

#### Scenario: progress-comment gate still controls the milestone comment

- **Given** an active worker, `postComments: true`,
  `commentEveryIterations: 10`, and `getIterationCount` returns `10`
- **When** `pollOnce` runs
- **Then** a comment whose body includes `iteration 10` is posted via
  `postComment`
- **And** `syncTasks(worker, 10)` is also called (via the always-on pass)
