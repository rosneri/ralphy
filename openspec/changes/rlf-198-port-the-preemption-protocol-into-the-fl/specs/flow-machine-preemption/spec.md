# Flow Machine Preemption

## ADDED Requirements

### Requirement: flowMachine exposes a `preempting` state

The `flowMachine` MUST include a `preempting` state that is entered when a `PREEMPT` event fires while the machine is in a worker-bearing state (`working`, `conflict-fix`, `ci-fix`) or the no-worker `awaiting` state.

#### Scenario: PREEMPT from working state enters preempting

Given the flowMachine is in the `working` state  
When a `PREEMPT` event fires with a new assignment  
Then the machine transitions to `preempting`  
And `context.pendingAssignment` equals the new assignment

#### Scenario: PREEMPT from awaiting state enters preempting

Given the flowMachine is in the `awaiting` state  
When a `PREEMPT` event fires  
Then the machine transitions to `preempting`  
And `context.worker` is undefined (no-worker path)

### Requirement: preemption actor runs the 8-step protocol with injectable graceMs

The invoked preemption actor MUST execute the 8-step protocol: emit `runtime.preempt.started` → SIGTERM → wait `graceMs` → SIGKILL if alive → await exit → teardown('cancelled') → persist → emit `runtime.preempt.completed`. The `graceMs` value MUST be injectable so tests can set it to a small value without real sleeps.

#### Scenario: SIGTERM respected within grace period

Given a worker that exits gracefully on SIGTERM  
When the preemption actor runs with graceMs=50  
Then SIGKILL is never sent  
And `runtime.preempt.started` is emitted before `runtime.preempt.completed`

#### Scenario: SIGTERM ignored triggers SIGKILL escalation

Given a worker that ignores SIGTERM  
When the preemption actor runs with graceMs=50  
Then SIGKILL is sent after the grace period  
And the worker exits  
And `runtime.preempt.completed` is emitted last

### Requirement: no-worker path skips SIGTERM/SIGKILL

When the machine is in a state with no active worker and `PREEMPT` fires, the actor MUST skip the SIGTERM and SIGKILL steps.

#### Scenario: no-worker preemption completes without kill calls

Given the flowMachine is in the `awaiting` state with no `context.worker`  
When a `PREEMPT` event fires  
Then no kill signal is sent  
And `runtime.preempt.started` and `runtime.preempt.completed` are still emitted  
And the new assignment is persisted

### Requirement: post-preemption routing resolves to the correct state

After `preempting` completes, the machine MUST transition to the state that corresponds to `pendingAssignment.flowId`.

#### Scenario: pendingAssignment with conflict-fix flowId routes to conflict-fix state

Given preemption completes with `pendingAssignment.flowId = "conflict-fix"`  
Then the machine enters the `conflict-fix` state

#### Scenario: pendingAssignment with awaiting-ci flowId routes to awaiting state

Given preemption completes with `pendingAssignment.flowId = "awaiting-ci"`  
Then the machine enters the `awaiting` state

### Requirement: WORKER_SPAWNED event updates context worker handle

When the coordinator spawns a new subprocess, it MUST send a `WORKER_SPAWNED` event so the machine holds the current `FlowWorker` reference in context.

#### Scenario: WORKER_SPAWNED in working state stores worker

Given the flowMachine is in the `working` state  
When a `WORKER_SPAWNED` event fires with a worker handle  
Then `context.worker` equals the provided handle  
And the machine remains in `working`
