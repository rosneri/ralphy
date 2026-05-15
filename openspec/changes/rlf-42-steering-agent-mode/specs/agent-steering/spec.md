# agent-steering — Live steering in agent mode restarts the active worker

## ADDED Requirements

### Requirement: AgentCoordinator MUST expose a restartWorker method that kills and immediately respawns the worker

`AgentCoordinator` MUST expose `restartWorker(changeName: string): Promise<boolean>`. When called with the name of a currently-active worker, the coordinator MUST:

1. Send a kill signal to the worker's subprocess (delegating to the wire-layer `WorkerHandle.kill`).
2. Mark the worker as `restarting` so its natural exit path does NOT trigger `notifyExited`'s Linear side-effects (`setError`, `setDone`, completion comment, `setInProgress` removal).
3. Once the worker's `exited` promise resolves, re-enqueue the same issue at the head of the queue with `mode: "resume"` and call `spawnNext()` immediately, without waiting for the next `pollOnce` cycle.
4. Return `true` if a worker was found and restart was scheduled; `false` if no active worker matches `changeName`.

Restarted workers MUST NOT consume an additional `maxTickets` slot — the `ticketsStarted` counter MUST NOT be incremented for a restart-driven respawn.

#### Scenario: restartWorker kills the active worker and respawns it as resume

- **Given** an `AgentCoordinator` with one active worker for change `rlf-99-foo` spawned as `fresh` mode
- **When** `restartWorker("rlf-99-foo")` is called
- **Then** the worker's `kill()` is invoked exactly once
- **And** once the killed worker's `exited` promise resolves, a new worker for `rlf-99-foo` is spawned with `mode: "resume"`
- **And** no `setError` or `setDone` indicator is applied for the killed worker
- **And** no completion comment is posted on the Linear issue
- **And** the method returns `true`

#### Scenario: restartWorker on an unknown change returns false

- **Given** an `AgentCoordinator` with no active worker for change `rlf-missing`
- **When** `restartWorker("rlf-missing")` is called
- **Then** no kill is invoked
- **And** the method returns `false` synchronously (or via a resolved promise)

#### Scenario: restartWorker is a no-op after stop

- **Given** an `AgentCoordinator` whose `stop()` has been called
- **When** `restartWorker("rlf-99-foo")` is called for what was an active worker
- **Then** the method returns `false`
- **And** no new worker is spawned

### Requirement: AgentMode steering submission MUST restart the focused worker after appending steering

The `SteeringField.onSubmit` handler in `apps/agent/src/components/AgentMode.tsx` MUST, after successfully calling `appendSteering(changeDir, message)`, call `coordinator.restartWorker(changeName)` for the worker the steering field is attached to. The steering append MUST happen before the restart so that the replacement worker's first iteration reads the new `steering.md` content.

If `restartWorker` returns `false` (worker not active), the steering append still succeeds and AgentMode MUST log an informational line indicating the steering will be picked up on the next iteration rather than throwing.

The `AgentModeCoordinator` structural interface in `AgentMode.tsx` MUST include `restartWorker(changeName: string): Promise<boolean>` so test mocks and the real coordinator agree on the shape.

#### Scenario: submitting steering for a running worker restarts it

- **Given** AgentMode is rendered with one focused active worker for change `rlf-99-foo`
- **And** the steering field is open with the message "use bun, not pnpm"
- **When** the user submits the steering message
- **Then** `appendSteering(<tasksDir>/rlf-99-foo, "use bun, not pnpm")` is called and resolves first
- **And** `coordinator.restartWorker("rlf-99-foo")` is called exactly once afterwards
- **And** the steering append happens strictly before the restart call

#### Scenario: steering for an inactive worker does not throw

- **Given** AgentMode where the focused row's worker has just exited (no active worker for that change)
- **When** the user submits a steering message
- **Then** `appendSteering` is called
- **And** `restartWorker` is called and returns `false`
- **And** AgentMode logs an info line about deferred pickup
- **And** no error is surfaced to the user
