# RLF-39: Agent mode silently falls back to projectRoot when worktree creation fails

Source: [RLF-39](https://linear.app/neriros/issue/RLF-39/agent-mode-silently-falls-back-to-projectroot-when-worktree-creation)

## Problem

When `useWorktree: true` is configured (the default for agent mode runs against
Linear), each issue is supposed to execute in an isolated git worktree under
`~/.ralph/<project>/worktrees/<issue-id>`. The current implementation of
`setupWorktree()` in `apps/agent/src/agent/wire.ts` wraps the call to
`createWorktree()` in a `try/catch` that, on failure, logs a yellow warning
and **leaves `workerCwd` pointing at `projectRoot`**. The agent then runs the
task — scaffolds change files, checks out a branch, edits source files,
commits — directly in the developer's main checkout. This was observed for
RLF-35, which created branch `rlf-35-agent-mode-steering` in
`/Users/neri/Developer/ralphy` and corrupted the working tree.

Silent fallback is dangerous: the user explicitly opted in to isolation, and
the warning is easily missed in a long log stream.

## Approach

Treat worktree creation as load-bearing. When `useWorktree: true`:

1. If `createWorktree()` throws, **rethrow** from `setupWorktree()` with a
   loud red log line. Do not assign `workerCwd = projectRoot`.
2. `AgentCoordinator.launchWorker()` already catches `prepare()` errors and
   logs them red, removes the pending id, and proceeds to the next issue —
   so a thrown setupWorktree propagates naturally and the issue retries on
   the next poll cycle (option 1 from the issue).
3. Fallback-to-`projectRoot` remains the correct behaviour when `useWorktree`
   is unset/false (the existing early-return path).

## Acceptance criteria

- With `useWorktree: true`, a `createWorktree()` failure does not modify
  files in the main project root — `setupWorktree()` rejects rather than
  returning `workerCwd === projectRoot`.
- The failure is logged in red (not yellow) so it is visible.
- A unit test in `apps/agent/src/__tests__/` exercises the failure path and
  asserts that `setupWorktree()` (via `prepare()`) does not return a worker
  cwd equal to `projectRoot` when `useWorktree: true` and the underlying git
  runner throws.
- The pre-existing behaviour for `useWorktree: false` is preserved.

## Steering

_Add steering notes here as the loop runs._
