# Design for RLF-156

## Problem

`apps/loop/src/hooks/useLoop.ts` maintains a local `iter` counter (starts at 0 each process run) and passes it to `checkStopCondition`. The persistent state file tracks cumulative iterations in `state.iteration`, but that field is ignored by the max-iterations guard.

When the agent respawns a worker (via `runPostTask` → `respawnWorker`, or via the pre-checked items normalization path in `worker.ts`), the new process starts `iter = 0` while `state.iteration` may already be at or past the configured limit. The guard `iter >= maxIterations` evaluates false and the loop continues indefinitely.

## Fix

In `useLoop.ts`, snapshot `currentState.iteration` into `startingIteration` before entering the loop. Replace both `checkStopCondition(currentState, iter, ...)` calls with `checkStopCondition(currentState, startingIteration + iter, ...)`.

- **Pre-iteration guard** (line ~166): stops immediately if the cumulative count already meets the limit.
- **Pre-delay guard** (line ~406): stops the delay phase correctly after the last allowed iteration.

Fresh runs are unaffected (`startingIteration = 0`).

## Files Touched

| File                                            | Change                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/loop/src/hooks/useLoop.ts`                | Add `startingIteration` capture; update two `checkStopCondition` calls |
| `apps/loop/src/hooks/__tests__/useLoop.test.ts` | Add test verifying `startingIteration` usage                           |

## Edge Cases

- **Fresh run**: `startingIteration = 0` → no behavior change.
- **Resumed run with 0 maxIterations** (unlimited): `checkStopCondition` short-circuits on `maxIterations > 0` → no behavior change.
- **State exactly at limit on spawn**: Pre-iteration guard fires immediately → loop exits without running the engine. Correct.
- **State past the limit** (e.g., state=7, limit=5): Pre-iteration guard fires immediately (7 ≥ 5). Correct.
