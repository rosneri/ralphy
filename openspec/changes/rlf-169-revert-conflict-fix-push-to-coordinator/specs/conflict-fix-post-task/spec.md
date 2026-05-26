# Spec: conflict-fix post-task flow

## MODIFIED Requirements

### Requirement: conflict-fix trigger flows through runPrPhase

The `conflict-fix` trigger MUST flow through the coordinator's `runPrPhase` identically to `fresh`, `resume`, and `review` triggers. The worker resolves conflicts and commits; `runPrPhase` pushes the branch and surfaces the existing PR. `clearConflicted` is called by `runPostTask` after `runPrPhase` returns 0.

The worker task body injected by `prepareTaskForTrigger` MUST NOT instruct the worker to push; it MUST only tell the worker to fetch + rebase, resolve conflicts, and commit.

#### Scenario: successful conflict-fix worker calls clearConflicted via runPrPhase

- **GIVEN** a conflict-fix worker iteration exits with code 0
- **AND** the branch has commits ahead of base
- **WHEN** `runPostTask` runs with `mode === "conflict-fix"`
- **THEN** `runPrPhase` is invoked
- **AND** `git push -u origin <branch>` is called
- **AND** `clearConflicted` is called exactly once after `runPrPhase` returns 0

#### Scenario: worker task body does not include push instruction

- **GIVEN** `prepareTaskForTrigger` is called for a `conflict-fix` trigger
- **WHEN** the task body is built
- **THEN** the body contains step instructions for fetch/rebase, conflict resolution, and commit
- **AND** the body does NOT contain a `git push --force-with-lease` command
- **AND** the body does NOT contain "post-task harness will NOT push for you"

## REMOVED Requirements

### Requirement: conflict-fix verify-only short-circuit

The `mode === "conflict-fix"` early-return block in `runPostTask` that called `fetchPrStatus` directly and never invoked `runPrPhase` is removed. No special short-circuit path exists for conflict-fix.

#### Scenario: conflict-fix no longer short-circuits before runPrPhase

- **GIVEN** `runPostTask` is called with `mode === "conflict-fix"` and `exitCode === 0`
- **WHEN** the function runs
- **THEN** the code does NOT early-return before calling `runPrPhase`
- **AND** `fetchPrStatus` is NOT called directly from `runPostTask`

### Requirement: feature-level conflictFixPostTask

The `postTask` hook on `conflictFixFeature` is removed. The feature registry no longer invokes a conflict-fix-specific post-task verifier.

#### Scenario: conflictFixFeature has no postTask

- **GIVEN** the `conflictFixFeature` object is imported from the feature registry
- **WHEN** its properties are inspected
- **THEN** `conflictFixFeature.postTask` is undefined
