# Design for RLF-257 — decompose post-task into a named-phase pipeline

## Goal

Turn `apps/agent/src/agent/post-task.ts` (1395 LOC) into a thin orchestrator over named modules, with worktree cleanup + teardown run **exactly once** through a single shared exit path. Strictly behavior-preserving.

## Current structure (verified 2026-06-13)

The file is already partly modular — `runPrPhase`, `runWorktreeCleanupPhase`, `runTeardownPhase`, and `runValidateOnlyPhase` are exported functions — but everything lives in one file and the orchestrator branches into three independent flows, each with its own copy-pasted terminal cleanup:

| Concern                              | Symbols                                                                                                                                                              | Lines                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| PR create + retry / merge-resolution | `createPrWithRetry`                                                                                                                                                  | `:427-602`             |
| PR phase                             | `runPrPhase`, `findNeverTouchViolations`, `findExistingOpenPrUrl`, `detectRepoAutoMergeAllowed`, `repoAutoMergeCache`, `_resetRepoAutoMergeCache`                    | `:261-321`, `:609-923` |
| Respawn tier                         | `runWorkerWithFixTask`, `reactivateState`                                                                                                                            | `:329-416`             |
| Validate-only                        | `runValidateOnlyPhase`, `defaultRunCommand`                                                                                                                          | `:1037-1133`           |
| Cleanup                              | `runWorktreeCleanupPhase`                                                                                                                                            | `:925-990`             |
| Teardown                             | `runTeardownPhase`                                                                                                                                                   | `:992-1028`            |
| Orchestrator                         | `runPostTask`                                                                                                                                                        | `:1152-1395`           |
| Shared types/consts                  | `PostTaskInput`, `PostTaskCtx`, `PostTaskPhase`, `RetroDispositionInfo`, `PR_FAILED_EXIT`, `NO_CHANGES_EXIT`, `MAX_PR_CREATE_ATTEMPTS`, `summarizeUncommittedStatus` | scattered              |

### The four copy-pasted terminal sites (the core hazard)

`runWorktreeCleanupPhase(...)` immediately followed by `runTeardownPhase(...)` then `return` appears at:

1. `:1209-1214` — validate-only path (`effectiveCode` from `runValidateOnlyPhase`)
2. `:1265-1273` — conflict-fix unpushed-divergence guard (forces `PR_FAILED_EXIT`)
3. `:1333-1338` — conflict-fix verify success
4. `:1386-1392` — main PR path

## Constraints discovered

- **Folder-size gate.** `scripts/check-folder-size.ts` caps any dir under `apps/`/`packages/` at `MAX_FILES = 10` non-test source files. `apps/agent/src/agent/` already has 9. → extracted modules MUST live in a new subdir `apps/agent/src/agent/post-task/`, and that subdir must itself stay ≤ 10 source files.
- **Import compatibility.** Tests import `{ runPostTask, runPrPhase, runValidateOnlyPhase, NO_CHANGES_EXIT, _resetRepoAutoMergeCache, RetroDispositionInfo }` from `../agent/post-task`. Renaming `post-task.ts` → `post-task/index.ts` keeps that path resolving; `index.ts` re-exports every public symbol.
- **Bun-native only.** Keep `Bun.file`/`Bun.write`/`Bun.spawnSync` (already used in `reactivateState`, `defaultRunCommand`); no `node:fs` sync.
- **Never reduce coverage.** Each extracted module gets its own focused test; existing suites stay green.
- **High blast radius.** This is the worker terminal path that controls worktree/process cleanup → land incrementally, full `apps/agent` suite green after each task.

## Target layout — `apps/agent/src/agent/post-task/`

| File                     | Holds                                                                                                                                                             | ≈LOC  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `index.ts`               | `runPostTask` orchestrator + barrel re-exports of public symbols                                                                                                  | < 400 |
| `types.ts`               | `PostTaskInput`, `PostTaskCtx`, `PostTaskPhase`, `RetroDispositionInfo`, `PostTaskMode`, exit-code consts, `MAX_PR_CREATE_ATTEMPTS`, `summarizeUncommittedStatus` | ~180  |
| `respawn.ts`             | `runWorkerWithFixTask`, `reactivateState`                                                                                                                         | ~110  |
| `pr-create.ts`           | `createPrWithRetry` (+ non-ff merge-resolution)                                                                                                                   | ~190  |
| `pr-phase.ts`            | `runPrPhase`, `findNeverTouchViolations`, `findExistingOpenPrUrl`, `detectRepoAutoMergeAllowed`, `_resetRepoAutoMergeCache`                                       | ~330  |
| `conflict-fix-verify.ts` | conflict-fix mergeability probe + unpushed-divergence guard                                                                                                       | ~140  |
| `validate-only.ts`       | `runValidateOnlyPhase`, `defaultRunCommand`                                                                                                                       | ~100  |
| `cleanup.ts`             | `runWorktreeCleanupPhase`                                                                                                                                         | ~70   |
| `teardown.ts`            | `runTeardownPhase` (single `runTeardown`)                                                                                                                         | ~40   |

9 files — within the 10-file cap (leaves room for an optional `pipeline.ts`; if added, fold `cleanup.ts` + `teardown.ts` into one `terminal.ts` to stay ≤ 10).

## Single-teardown design

`runPostTask` is restructured so the body computes `effectiveCode` and returns it from one shared exit, with cleanup + teardown in a `finally`-style wrapper that runs once:

```
async function runPostTask(input, deps) {
  const ctx = buildCtx(input, deps)
  let effectiveCode = input.exitCode
  try {
    // feature-registry walk (unchanged; runs for any exit code)
    // pipeline of phase handlers — each returns { effectiveCode, terminal }
    //   - validate-only handler
    //   - conflict-fix-verify handler (incl. unpushed guard)
    //   - PR-skip-on-nonzero handler
    //   - PR-phase handler
    //   - retro handler (main path only — see edge case)
    // run handlers until one is terminal; effectiveCode = its code
    emit(succeeded ? "done" : "gave-up", ...)   // emitted once, from the resolved code
    return effectiveCode
  } finally {
    await runWorktreeCleanupPhase({ ...effectiveCode... }, ...)
    await runTeardownPhase({ ... }, ...)
  }
}
```

Cleanup reads `effectiveCode`; the unpushed-divergence guard sets `effectiveCode = PR_FAILED_EXIT` (instead of passing it positionally) so the single `finally` preserves "preserve worktree on failure". The `finally` runs on the throw path too, satisfying the "teardown runs even on throw" scenario.

## Phase-pipeline model

Each handler: `(ctx) => Promise<{ effectiveCode: number; terminal: boolean }>`. The orchestrator iterates an ordered array, stops at the first `terminal: true`, and falls through to the single teardown. Branch selection (validate-only vs conflict-fix vs normal) becomes guard predicates on each handler rather than nested `if`/early-`return`.

## Edge cases / behavior to preserve exactly

- **`emit` parity.** validate-only emits `done`/`gave-up` before cleanup; conflict-fix emits `done` (and `gave-up`/"unpushed conflict resolution" on the guard); main emits `done`/`gave-up` with `exit N` detail. `NO_CHANGES_EXIT` counts as `done`, not `gave-up`. Preserve each emit and its timing.
- **Retro runs on the main path only.** `runRetrospective` fires at `:1375` on the normal PR path — NOT on validate-only or conflict-fix terminals. The unified exit must keep retro gated to the same condition (do not let the `finally` introduce a retro call on the other paths).
- **Feature-registry walk runs for any exit code**, before phase dispatch — keep it ahead of the pipeline.
- **Conflict-fix unpushed guard** must still fail the iteration (`PR_FAILED_EXIT`) and emit `gave-up` before cleanup; cleanup must preserve (not remove) the worktree because the code is non-zero.
- **`repoAutoMergeCache`** is module-level state shared with `_resetRepoAutoMergeCache` (used by tests) — move both into `pr-phase.ts` together so the test reset still clears the same map.
- **No `git push`/`createPrWithRetry` in conflict-fix mode** — the worker owns the push; the verify module only probes mergeability.
- **`allow-duplicate` markers** on `PR_FAILED_EXIT` / `NO_CHANGES_EXIT` must travel with the constants (the duplicate-declaration gate relies on them).

## Testing strategy

- New `post-task-single-teardown.test.ts`: asserts cleanup + teardown each run exactly once across all five terminal outcomes (success, ci/pr-failed, no-changes, validate, throw) using spy deps.
- Per-module tests for `pr-create`, `conflict-fix-verify`, `respawn`, mirroring the cases currently covered via the orchestrator so coverage does not drop.
- Existing suites (`post-task.test.ts`, `post-task-conflict-fix.test.ts`, `post-task-validate-only.test.ts`, `e2e-set-pr-ready*.test.ts`, `pr-no-op-classification.test.ts`, `pre-push-hook.test.ts`) must pass unchanged.
- Size-guard test asserting `post-task/index.ts` < 400 LOC (and, if generalized, a per-file budget map).

## Verification

```bash
wc -l apps/agent/src/agent/post-task/index.ts   # target < ~400
bun run typecheck && bun run check:structure
bun test apps/agent/src
```
