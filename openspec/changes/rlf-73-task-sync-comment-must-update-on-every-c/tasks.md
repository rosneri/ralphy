# Tasks for RLF-73

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-73/task-sync-comment-must-update-on-every-checked-task and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `apps/agent/src/agent/coordinator.ts`: add `lastSyncedIteration: number` to `ActiveWorker` (initialized to `0` on spawn since the launch path already syncs iteration 0).
- [x] In `apps/agent/src/agent/coordinator.ts`: introduce a `syncWorkerTasks()` private method that, when `deps.syncTasks` is wired, loops active workers, reads `getIterationCount`, and calls `syncTasks(w, count)` only when `count !== w.lastSyncedIteration`. On success, updates `lastSyncedIteration`. On error, logs a yellow warning and leaves the sentinel unchanged.
- [x] In `apps/agent/src/agent/coordinator.ts`: shrink `reportProgress` to only post the `🔄 Ralph progress update` comment (gated as today). Remove the duplicate `syncTasks` call from inside it.
- [x] In `apps/agent/src/agent/coordinator.ts`: invoke `syncWorkerTasks()` from `pollOnce` after `reportProgress()` so both run every poll.
- [x] Update `ActiveWorker` constructions in `coordinator.ts` (`spawn`, `notifyExited` synthetic) so the new field is set without breaking the typed shape.
- [x] Add test in `apps/agent/src/__tests__/coordinator.test.ts`: with `postComments: false`, `syncTasks` is called once per poll as iteration advances and no progress comment is posted.
- [x] Add test in `apps/agent/src/__tests__/coordinator.test.ts`: with `commentEveryIterations: 0`, `syncTasks` still fires but no progress comment is posted.
- [x] Add test in `apps/agent/src/__tests__/coordinator.test.ts`: when iteration count is unchanged between polls, `syncTasks` is NOT re-invoked.
- [x] Add test: when `syncTasks` throws, `lastSyncedIteration` is not advanced, so the next poll retries with the same count.
- [x] Run `bunx openspec validate rlf-73-task-sync-comment-must-update-on-every-c` and fix any reported issues.
- [x] Run `bun run lint` from repo root and fix any new findings.
- [x] Run `bun run test` (or the focused agent test suite) and ensure green.
