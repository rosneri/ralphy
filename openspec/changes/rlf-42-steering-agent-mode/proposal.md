# RLF-42: Steering Agent mode

Source: [RLF-42](https://linear.app/neriros/issue/RLF-42/steering-agent-mode)
Status: Todo
Assignee: Neriya Rosner

## Why

In agent mode, submitting a steering message currently only appends to `steering.md`. The running worker subprocess does not pick up the steering until its current inner iteration finishes naturally — which can take minutes when the engine is mid-tool-call. The task loop (interactive `ralph task`) already solves this by aborting the in-flight engine call and restarting with the steering applied immediately. Agent mode should behave the same way: when steering arrives, the active worker's current iteration should be cut short so a fresh iteration consumes the steering on its very next prompt.

## What Changes

- Add a `restartWorker(changeName)` method on `AgentCoordinator` that kills the active worker for the named change, suppresses its `notifyExited` side-effects, and immediately re-enqueues the issue as `resume` mode (bypassing the next Linear poll cycle).
- Wire `SteeringField.onSubmit` in `apps/agent/src/components/AgentMode.tsx` so that, after `appendSteeringMessage` succeeds, the focused worker is restarted via the coordinator.
- Expose `restartWorker` through the `AgentModeCoordinator` structural interface so tests can verify the steering-triggered restart path.
- Add tests covering coordinator restart semantics, AgentMode steering-triggered restart, and graceful no-op when the focused worker is not active.

## Acceptance Criteria

- Submitting steering in agent mode while a worker is running causes that worker's subprocess to receive SIGTERM and the steering content is present in `steering.md` before the replacement worker is spawned.
- The replacement worker spawns within the same tick (no wait for `fetchInProgress` re-detection).
- If the worker for the focused change is not currently active, steering is appended and no kill is attempted (no crash).
- A restart-driven exit MUST NOT post a `✗ Ralph exited` comment, apply `setError`, or remove `setInProgress`.
- `bun run lint` and `bun run test` pass; `bunx openspec validate rlf-42-steering-agent-mode` passes.

## Steering

_Add steering notes here as the loop runs._
