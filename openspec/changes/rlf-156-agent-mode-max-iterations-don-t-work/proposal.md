# RLF-156: Agent mode max iterations don't work

Source: [RLF-156](https://linear.app/neriros/issue/RLF-156/agent-mode-max-iterations-dont-work)
Status: In Progress
Assignee: Neriya Rosner

## Why

When the agent spawns (or respawns) a worker loop, the worker process starts with a fresh local iteration counter (`iter = 0`). The `checkStopCondition` check uses this local counter rather than the cumulative iteration count stored in state. As a result, iterations completed in previous runs are not counted toward `maxIterations`, so the loop never stops on agent-respawned workers even when the limit is configured.

Concrete scenario: a change has already completed 10 iterations (recorded in `.ralph-state.json`). The agent respawns it with `--max-iterations 10`. The new process starts `iter = 0`, so `checkStopCondition` sees 0 ≥ 10 → false, and runs 10 more iterations instead of stopping immediately.

## What Changes

- `apps/loop/src/hooks/useLoop.ts`: Capture `startingIteration = currentState.iteration` before the loop begins (reflecting iterations from prior runs). Pass `startingIteration + iter` to both `checkStopCondition` calls (the pre-iteration guard and the pre-delay guard) so the total accumulated iteration count is compared against `maxIterations`.
- `apps/loop/src/hooks/__tests__/useLoop.test.ts`: Add a static-analysis test confirming `startingIteration` is used in the hook source.

## Additional instructions

You are working on RLF-156: Agent mode max iterations don't work.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
