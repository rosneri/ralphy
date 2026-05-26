# Design for RLF-169

## Problem

After RLF-82, two divergent post-task paths exist:

- **conflict-fix**: worker owns `git push --force-with-lease`, post-task short-circuit verifies mergeability and calls `clearConflicted`
- **fresh / resume / review**: post-task `runPrPhase` owns push via `createPrWithRetry` → `createPullRequest`, then `fixConflictsAndCiLoop` handles CI + re-conflict loops

This divergence makes `post-task.ts` harder to reason about and prevents `fixConflictsAndCiLoop`'s re-check logic from running for the initial conflict-fix push.

## Target Flow (after this change)

All triggers (fresh / resume / review / **conflict-fix**) go through `runPrPhase`:

1. Worker runs, resolves conflicts, commits (does NOT push)
2. `runPostTask` checks `effectiveCode === 0 && wantPr` → calls `runPrPhase`
3. `runPrPhase` → `createPrWithRetry` → `createPullRequest`:
   - `git log main..HEAD` → has commits → proceed
   - `git push -u origin <branch>` (idempotent)
   - `gh pr list --head <branch>` → existing PR URL (returned as `{ url, created: false }`)
4. `fixConflictsAndCiLoop(ctx, prUrl, wantFixCi, checkPrConflict)`:
   - If `checkPrConflict` wired (`wantConflictLoop = true`) and PR still CONFLICTING → spawn worker again + `pushWithLeases()`
   - If CI fix requested → poll CI
   - Returns 0 on success
5. Back in `runPostTask`: if `input.mode === "conflict-fix" && effectiveCode === 0` → call `deps.clearConflicted()`

## Files to Touch

### `apps/agent/src/agent/post-task.ts`

- **Delete** lines 1102–1163 (the `mode === "conflict-fix"` short-circuit block and its comment)
- **Add** after the `runPrPhase` call returns: call `deps.clearConflicted()` when `input.mode === "conflict-fix" && effectiveCode === 0`

### `apps/agent/src/agent/wire/prepare.ts`

- In `prepareTaskForTrigger` (conflict-fix branch, lines 277–313):
  - Remove step 4 (`git push --force-with-lease ...`)
  - Remove the "post-task harness will NOT push for you" paragraph (lines 289–298)
  - Update step numbering (now only 3 steps: fetch+rebase, resolve, stage+commit)

### `apps/agent/src/features/conflict-fix/postTask.ts`

- **Delete** (entire file)

### `apps/agent/src/features/conflict-fix/index.ts`

- Remove `import { conflictFixPostTask } from "./postTask";`
- Remove `postTask: conflictFixPostTask` from the feature object
- Update the JSDoc comment to remove the postTask references

### `apps/agent/src/features/conflict-fix/__tests__/postTask.test.ts`

- **Delete** (entire file)

### `apps/agent/src/__tests__/post-task-conflict-fix.test.ts`

- **Rewrite**: old tests verified that conflict-fix does NOT push. New tests verify it DOES push and clearConflicted is called on success.
- New test shape:
  - `makeCmd` must handle `git status --porcelain`, `git diff --name-only`, `git log --oneline`, `git push`, `gh pr list --head`, and optionally `gh pr view`
  - Test 1: success path — worker exits 0, push succeeds, existing PR found, clearConflicted called once
  - Test 2: worker exits non-zero — PR phase skipped, no push, no clearConflicted
  - Test 3: no existing PR (no commits) — runPrPhase returns 0 without clearConflicted (no PR to surface)

### `apps/agent/src/runtime/coordinator.ts`

- Update comment at lines 1217–1220 to remove the RLF-82 ownership reference; replace with: "The coordinator only resets conflict bookkeeping here — clearConflicted is called by post-task after runPrPhase confirms the PR is merged."

## Edge Cases

- **`createPullRequest` with existing PR**: already handled — lines 214–232 of `pr.ts` do `git push -u origin ${branch}` (idempotent) then return the existing PR URL if found via `gh pr list`.
- **`wantConflictLoop` in `fixConflictsAndCiLoop`**: if `checkPrConflict` is wired (it is in production), `wantConflictLoop = true` and the loop re-checks conflict status after each push, naturally replacing the old short-circuit verify logic.
- **`clearConflicted` not wired**: the call is guarded by `deps.clearConflicted` existence check (same pattern as before).
- **Non-conflict-fix triggers**: the `clearConflicted` call is gated on `input.mode === "conflict-fix"` so fresh/resume/review are unaffected.
- **Worker exits non-zero in conflict-fix**: `wantPr` is true but `effectiveCode !== 0` → `runPrPhase` is skipped → `clearConflicted` is NOT called (correct: we don't know if conflicts were resolved).
