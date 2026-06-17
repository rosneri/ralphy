# Spec: post-task orchestration

## ADDED Requirements

### Requirement: worktree cleanup and teardown run exactly once per outcome

The post-task orchestrator (`runPostTask`) MUST run worktree cleanup followed by the teardown script exactly once for every terminal outcome, through a single shared exit path rather than copy-pasted at each return site.

The terminal outcomes are: success-with-PR, no-changes (`NO_CHANGES_EXIT`), PR-failed (`PR_FAILED_EXIT`), validate-only (pass and fail), conflict-fix verify success, conflict-fix unpushed-divergence failure, and an unexpected throw.

#### Scenario: cleanup + teardown fire once on PR success

- **GIVEN** a worker that exited 0 with `wantPr` and a tracked branch that opens a PR
- **WHEN** `runPostTask` completes
- **THEN** the worktree-cleanup phase runs once and the teardown script runs once, in that order

#### Scenario: cleanup + teardown fire once on PR failure

- **GIVEN** a worker whose PR phase returns `PR_FAILED_EXIT`
- **WHEN** `runPostTask` completes
- **THEN** the teardown script still runs exactly once and the worktree is preserved (never force-removed on failure)

#### Scenario: cleanup + teardown fire once on the conflict-fix path

- **GIVEN** `mode === "conflict-fix"` and a worker that exited 0
- **WHEN** the mergeability verify path returns (success or the unpushed-divergence failure)
- **THEN** worktree cleanup and the teardown script each run exactly once before returning

#### Scenario: cleanup + teardown fire once on the validate-only path

- **GIVEN** `wantValidateOnly` is set and the worker exited 0
- **WHEN** `runValidateOnlyPhase` returns its effective code
- **THEN** worktree cleanup and the teardown script each run exactly once before returning

#### Scenario: teardown still runs when a phase throws

- **GIVEN** any post-task phase throws an unexpected error
- **WHEN** the throw propagates through `runPostTask`
- **THEN** the teardown script still runs exactly once before the error surfaces

### Requirement: post-task.ts is a thin orchestrator over extracted modules

The post-task surface MUST be decomposed so that PR creation/retry, merge-resolution, conflict-fix verification, and the fix-task respawn tier each live in their own module under `apps/agent/src/agent/post-task/`, leaving the orchestrator a thin composition layer.

The decomposition MUST be strictly behavior-preserving: the public exports consumed by the agent app and existing tests (`runPostTask`, `runPrPhase`, `runValidateOnlyPhase`, `NO_CHANGES_EXIT`, `_resetRepoAutoMergeCache`, `RetroDispositionInfo`, and the existing phase types) remain importable from the same `../agent/post-task` path.

#### Scenario: existing post-task imports keep resolving

- **GIVEN** a test that imports `runPostTask`, `runPrPhase`, or `NO_CHANGES_EXIT` from `../agent/post-task`
- **WHEN** the decomposition lands
- **THEN** the import resolves unchanged and every existing `apps/agent` post-task test passes

#### Scenario: orchestrator file stays within its size budget

- **GIVEN** the decomposed orchestrator entry point
- **WHEN** the structure/size check runs
- **THEN** the orchestrator entry file is well under its previous size (target < ~400 LOC) and the check fails if it regrows past the budget
