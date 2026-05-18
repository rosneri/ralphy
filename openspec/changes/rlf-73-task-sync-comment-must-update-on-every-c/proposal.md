# RLF-73: Task-sync comment must update on every checked task

Source: [RLF-73](https://linear.app/neriros/issue/RLF-73/task-sync-comment-must-update-on-every-checked-task)
Status: In Progress
Labels: ralph:auto-merge

## Why

The sticky Linear tasks comment (managed by
`apps/agent/src/agent/linear-sync/comment-sync.ts`) is currently only refreshed
on:

1. Worker launch (iteration 0)
2. Progress milestones — gated on `commentEveryIterations > 0` AND
   `postComments !== false` (see
   `apps/agent/src/agent/coordinator.ts:403-450`).
3. Worker exit (done transition)

When users set `postComments: false` (the common production setup to suppress
the noisy "🔄 progress" comments), the sticky tasks comment stops refreshing
entirely because the entire `reportProgress` body is short-circuited at line
405 — so `syncTasks` never fires between launch and exit. The comment stays
frozen at "_No mission tasks yet — planning in progress._" even as the loop
ticks for hours and checks off task after task.

Real example: [LIT-192](https://linear.app/neriros/issue/LIT-192) — tasks
comment stuck at iteration 0 with no rendered tasks despite the loop having
progressed.

## What Changes

- Decouple the sticky **tasks-comment refresh** from the progress-comment
  gate. `syncTasks` runs every poll for every active worker regardless of
  `postComments` or `commentEveryIterations`.
- Keep the existing "🔄 Ralph progress update" comment behind the existing
  gate — that comment is the noisy one users opt out of, the tasks comment
  is the source of truth.
- Track `lastSyncedIteration` per worker so we skip the Linear update when
  the iteration count has not advanced since the previous sync (avoids
  pointless API churn when the worker hasn't ticked yet).
- Update `coordinator.test.ts` to cover both new shapes: tasks comment
  refreshes on every poll when `postComments: false`, and the gated progress
  comment still respects the gate.

## Acceptance criteria

- With `postComments: false` and `commentEveryIterations: 0`, the sticky
  tasks comment is updated on every poll where the worker's iteration count
  advanced.
- With the gate enabled, the "🔄 Ralph progress update" comment fires on
  milestone iterations as it does today.
- Iteration counter in the comment footer always reflects the current
  `.ralph-state.json` `iteration` value (within one poll tick).

## Steering

_Add steering notes here as the loop runs._
