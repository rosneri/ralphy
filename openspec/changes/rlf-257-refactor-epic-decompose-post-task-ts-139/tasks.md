# Tasks for RLF-257

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-257/refactorepic-decompose-post-taskts-1395-loc-into-a-named-phase and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

Land in order — each task must leave `bun run typecheck`, `bun run check:structure`, and `bun test apps/agent/src` green before the next.

### Step 1 — Single teardown (keystone)

- [x] Add a failing test `apps/agent/src/__tests__/post-task-single-teardown.test.ts` asserting `runWorktreeCleanupPhase` and `runTeardownPhase` each run exactly once for every terminal outcome: PR success, PR-failed (`PR_FAILED_EXIT`), no-changes (`NO_CHANGES_EXIT`), validate-only (pass + fail), conflict-fix verify success, conflict-fix unpushed-divergence failure, and a thrown error (use spy `runScript`/`git` deps and count calls)
- [x] Restructure `runPostTask` so all terminal paths set a mutable `effectiveCode` and return through one shared exit; run cleanup + teardown once in a `finally`-style wrapper (covers the throw case too)
- [x] Move the conflict-fix unpushed guard to set `effectiveCode = PR_FAILED_EXIT` and `emit("gave-up", ...)` rather than returning with copy-pasted cleanup; verify the worktree is still preserved on the non-zero code
- [x] Confirm `runRetrospective` still fires only on the main PR path (not validate-only / conflict-fix), and `emit` parity (`done`/`gave-up`/`NO_CHANGES_EXIT`→`done`) is preserved
- [x] Run `bun run typecheck && bun run check:structure && bun test apps/agent/src`

### Step 2 — Move surface into `agent/post-task/` and extract shared types

- [x] Create `apps/agent/src/agent/post-task/` and move `post-task.ts` to `post-task/index.ts`; verify `../agent/post-task` still resolves for all existing test imports
- [x] Extract `post-task/types.ts` with `PostTaskInput`, `PostTaskCtx`, `PostTaskPhase`, `PostTaskMode`, `RetroDispositionInfo`, `PR_FAILED_EXIT`, `NO_CHANGES_EXIT` (keep `allow-duplicate` markers), `MAX_PR_CREATE_ATTEMPTS`, `summarizeUncommittedStatus`; re-export public symbols from `index.ts`
- [x] Run typecheck + structure + `bun test apps/agent/src` (confirm `check-folder-size` passes — `agent/` drops to 8, `post-task/` ≤ 10)

### Step 3 — Extract respawn tier

- [x] Move `runWorkerWithFixTask` + `reactivateState` (with the append-only history guard) into `post-task/respawn.ts`; document that its stop semantics are a separate authority from `loopMachine`
- [x] Add `post-task/__tests__` (or `apps/agent/src/__tests__`) coverage for the append-only history rewrite guard and the prepend/reactivate path
- [x] Run typecheck + structure + tests

### Step 4 — Extract PR creation + merge-resolution

- [x] Move `createPrWithRetry` (including non-fast-forward merge + conflict-fix-task handling) into `post-task/pr-create.ts`
- [x] Add focused tests for the push-rejection retry budget, non-ff merge, and merge-conflict fix-task paths
- [x] Run typecheck + structure + tests

### Step 5 — Extract PR phase

- [x] Move `runPrPhase`, `findNeverTouchViolations`, `findExistingOpenPrUrl`, `detectRepoAutoMergeAllowed`, `repoAutoMergeCache`, and `_resetRepoAutoMergeCache` into `post-task/pr-phase.ts` (cache + reset together so the test reset clears the same map)
- [x] Confirm `e2e-set-pr-ready*.test.ts` pass unchanged (no `pr-no-op-classification.test.ts` exists in this repo; no-op coverage lives in `post-task-no-op.test.ts`, also green)
- [x] Run typecheck + structure + tests

### Step 6 — Extract conflict-fix verify and validate-only

- [ ] Move the `mode === "conflict-fix"` mergeability-probe block + unpushed-divergence guard into `post-task/conflict-fix-verify.ts`
- [ ] Move `runValidateOnlyPhase` + `defaultRunCommand` into `post-task/validate-only.ts`, and `runWorktreeCleanupPhase` / `runTeardownPhase` into `post-task/cleanup.ts` / `post-task/teardown.ts`
- [ ] Confirm `post-task-conflict-fix.test.ts` and `post-task-validate-only.test.ts` pass unchanged
- [ ] Run typecheck + structure + tests

### Step 7 — Phase pipeline model

- [ ] Refactor `runPostTask` body into an ordered list of phase handlers each returning `{ effectiveCode, terminal }`; the orchestrator runs until one is terminal, then the single teardown. If a `pipeline.ts` file is added, fold `cleanup.ts` + `teardown.ts` into one `terminal.ts` to keep `post-task/` ≤ 10 source files
- [ ] Run typecheck + structure + tests

### Step 8 — Size guard

- [ ] Add a structure test asserting `apps/agent/src/agent/post-task/index.ts` is under ~400 LOC so the orchestrator cannot regrow (prefer wiring into `check:structure` / a per-file budget; never reduce the coverage threshold)
- [ ] Run typecheck + structure + tests

### Final verification

- [ ] `wc -l apps/agent/src/agent/post-task/index.ts` confirms the orchestrator is well under its previous 1395 LOC (target < ~400)
- [ ] `bun run lint && bun run typecheck && bun run check:structure && bun test apps/agent/src` all pass; coverage not reduced
- [ ] `bunx openspec validate rlf-257-refactor-epic-decompose-post-task-ts-139` passes
