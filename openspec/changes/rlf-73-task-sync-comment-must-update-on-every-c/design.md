# Design for RLF-73

## Files touched

- `apps/agent/src/agent/coordinator.ts`
  - Add `lastSyncedIteration: number` to `ActiveWorker` (initialized to `-1`
    so the first sync after launch always fires even when iteration is `0`).
  - Replace the single `reportProgress` method with two passes invoked from
    `pollOnce`:
    1. `syncWorkerTasks()` — always runs when `deps.syncTasks` is wired.
       Iterates active workers, reads `getIterationCount`, and calls
       `syncTasks(w, count)` whenever `count !== w.lastSyncedIteration`.
       Updates `lastSyncedIteration` on success.
    2. `postProgressComments()` — runs only when
       `commentEveryIterations > 0 && postComments !== false`. Same
       milestone logic as today, but only posts the
       `🔄 Ralph progress update` comment via `deps.postComment`.
       The previous duplicate `syncTasks` call inside the milestone branch
       is removed (the always-on pass already handled it).
- `apps/agent/src/__tests__/coordinator.test.ts`
  - Add a test: with `postComments: false`, `syncTasks` is still invoked
    once per poll per worker as iteration advances.
  - Add a test: with `commentEveryIterations: 0`, `syncTasks` still fires
    but no `🔄 progress update` comment is posted.
  - Existing milestone test continues to pass.

## Data flow

```
pollOnce()
  ├─ fetch & enqueue
  ├─ spawnNext()
  ├─ scanDoneForConflicts()
  ├─ syncWorkerTasks()        ← always (when syncTasks wired)
  │     for w in workers:
  │       count = getIterationCount(w.changeName)
  │       if count !== w.lastSyncedIteration:
  │         syncTasks(w, count)
  │         w.lastSyncedIteration = count
  └─ postProgressComments()   ← gated on commentEveryIterations + postComments
```

`syncTasks` on launch (iteration 0) is unchanged — still called from
`spawn()` directly. The exit-path `syncTasks` in `notifyExited` is also
unchanged.

## Edge cases

- `getIterationCount` throws → log warning, skip this worker this poll, do
  NOT bump `lastSyncedIteration` so we retry next poll. Same fallback as
  today.
- `syncTasks` throws → log warning, do NOT bump `lastSyncedIteration` so
  next poll retries. (Today the milestone branch updates
  `lastReportedIteration` regardless of `syncTasks` outcome — that field
  is now only for the progress-comment milestone, so we keep that
  behavior to avoid spamming progress comments on transient sync failure.)
- Worker iteration count of `0` after launch (state file not yet written
  by the worker) → the initial sync from `spawn()` already covered
  iteration 0; the always-on pass skips because `0 === lastSyncedIteration`
  is now `0 === 0` after we initialize `lastSyncedIteration = 0` on
  launch. Use `lastSyncedIteration = -1` as the initial sentinel so the
  first poll-driven sync after the launch sync only fires once iteration
  reaches `1`. (Initial launch already produced iteration 0 sync.)

  Actually: initialize `lastSyncedIteration = 0` after the launch sync
  succeeds (the launch path already syncs at iteration 0). If launch sync
  is skipped (no syncTasks deps), this field is irrelevant.

## No file-watch (for now)

The Linear issue suggests a `tasks.md` file watcher. We're deferring that:
the agent loop typically writes `.ralph-state.json` once per iteration and
the dashboard polls on `pollInterval`. A per-poll refresh is enough to
satisfy "comment reflects within one iteration" without adding a new
watcher subsystem.
