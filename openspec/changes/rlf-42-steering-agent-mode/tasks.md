# Tasks for RLF-42

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-42/steering-agent-mode and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [ ] Add a `restarting: boolean` field to `ActiveWorker` in `apps/agent/src/agent/coordinator.ts` (default `false` when constructed in `launchWorker`).
- [ ] Implement `AgentCoordinator.restartWorker(changeName: string): Promise<boolean>` in `apps/agent/src/agent/coordinator.ts`: returns `false` if `stopped` or no active worker matches; otherwise sets `worker.restarting = true`, captures `{ issue, mode }`, fires `capture("agent_worker_restarted", { change_name, reason: "steering" })`, calls `worker.kill()`, and returns `true`.
- [ ] Modify the `handle.exited.then(...)` block in `launchWorker` so that when `worker.restarting === true` it (a) skips `notifyExited`, (b) decrements `this.ticketsStarted` so the restart does not consume cap budget, (c) unshifts `{ issue, mode: "resume" }` onto `this.queue`, and (d) calls `spawnNext()`.
- [ ] Extend the `AgentModeCoordinator` structural interface in `apps/agent/src/components/AgentMode.tsx` with `restartWorker(changeName: string): Promise<boolean>`.
- [ ] Update `SteeringField.onSubmit` in `apps/agent/src/components/AgentMode.tsx` to call `coordRef.current?.restartWorker(w.changeName)` after a successful `appendSteering`, and log a cyan "steering applied, restarting worker" line when it returns `true` or a gray "steering queued — will apply on next iteration" line when it returns `false`.
- [ ] Create `apps/agent/src/__tests__/coordinator-restart-worker.test.ts` covering: (a) restart kills the active worker exactly once and re-spawns it as `resume`; (b) `notifyExited` side-effects (setError/setDone/postComment) are NOT invoked for the restart-driven exit; (c) `restartWorker` on an unknown change returns `false` and does not kill; (d) `restartWorker` after `stop()` returns `false`; (e) `ticketsStarted` is unchanged after a full restart cycle.
- [ ] Extend `apps/agent/src/__tests__/agent-mode-steering.test.tsx` to assert that `restartWorker` is called once with the focused change name after `appendSteering` resolves, with strict ordering (append-before-restart).
- [ ] Run `bun run lint` and fix any new lint findings.
- [ ] Run `bun run test` and ensure all tests pass without lowering the coverage threshold.
- [ ] Run `bunx openspec validate rlf-42-steering-agent-mode` and ensure validation passes.
