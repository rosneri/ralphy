# RLF-169: Revert conflict-fix push to coordinator post-task (consistency)

Source: [RLF-169](https://linear.app/neriros/issue/RLF-169/revert-conflict-fix-push-to-coordinator-post-task-consistency)
Status: In Progress

## Why

RLF-82 moved `git push` + rebase into the worker iteration for the `conflict-fix` trigger only, while other triggers (fresh / resume / review) still push from the coordinator's `runPrPhase`. This created two divergent post-task paths. RLF-168 (worker-owned push for all triggers) has been parked. To restore consistency in the meantime, revert RLF-82's worker-owned push so all triggers again go through the coordinator's `runPrPhase`.

## Background

[RLF-82](https://linear.app/neriros/issue/RLF-82/conflict-fix-flow-move-push-inside-the-ai-iteration-post-task-only) moved `git push` + rebase into the worker iteration for the `conflict-fix` trigger only. Other triggers (fresh / resume / review) still push from the coordinator's `runPrPhase`. Two divergent paths exist today.

We've decided to park the broader "everything moves to the worker" plan ([RLF-168](https://linear.app/neriros/issue/RLF-168/move-push-gh-pr-create-into-the-worker-iteration-hld-parked)). For consistency in the meantime, revert [RLF-82](https://linear.app/neriros/issue/RLF-82/conflict-fix-flow-move-push-inside-the-ai-iteration-post-task-only)'s worker-owned conflict-fix push so all triggers go through the coordinator's `runPrPhase` again.

## Scope

- `apps/agent/src/agent/post-task.ts`: remove the `mode === "conflict-fix"` short-circuit (lines ~1108-1163). Let conflict-fix flow through `runPrPhase` like the other triggers.
- `apps/agent/src/agent/wire/prepare.ts::prepareTaskForTrigger`: drop the conflict-fix injection that tells the worker to `git push --force-with-lease` itself. Keep the "resolve merge conflicts" instructions (worker still rebases), just remove the push step.
- `apps/agent/src/features/conflict-fix/postTask.ts`: delete (now a no-op since `caps.conflictFix` is never wired).
- Restore the `fixConflictsAndCiLoop` wantConflictLoop branch as the single conflict-resolution path.
- `clearConflicted` call moves back to post-task after `runPrPhase` returns 0, not from the short-circuit verify path.

## Tests to update

- `apps/agent/src/__tests__/post-task-conflict-fix.test.ts` — currently exercises the verify-only path; rewrite to test that conflict-fix flows through `runPrPhase` (git push is called, clearConflicted invoked on success).
- `apps/agent/src/features/conflict-fix/__tests__/postTask.test.ts` — delete (postTask removed from feature).
- Make sure the existing `fixConflictsAndCiLoop` conflict-recheck tests still cover the re-fix loop end-to-end.

## Definition of done

- `grep -rn "mode === \"conflict-fix\"" apps/agent/src` returns nothing meaningful.
- Conflict-fix run goes through `runPrPhase` → push branch → find existing PR → `fixConflictsAndCiLoop` → `clearConflicted`.
- `bun test apps/agent/src/__tests__/coordinator.test.ts` green.
- No regressions in the conflict-promotion path.

## What Changes

- Remove the `mode === "conflict-fix"` short-circuit from `runPostTask` in `post-task.ts` so conflict-fix flows through `runPrPhase` like all other triggers.
- Call `deps.clearConflicted()` from `runPostTask` after `runPrPhase` returns 0 when `input.mode === "conflict-fix"`.
- Strip the `git push --force-with-lease` injection (and its push-rejection guidance) from `prepareTaskForTrigger` in `wire/prepare.ts`; keep the rebase + conflict-resolve + commit instructions.
- Delete `apps/agent/src/features/conflict-fix/postTask.ts` and remove the `postTask` field from `conflictFixFeature` in `index.ts`.
- Delete the feature-level postTask test file `conflict-fix/__tests__/postTask.test.ts`.
- Rewrite `__tests__/post-task-conflict-fix.test.ts` to assert the new flow: git push is called, existing PR is surfaced, and `clearConflicted` is invoked on success.
- Update the coordinator comment that referenced RLF-82's verify-path ownership.

## Blocks

[RLF-168](https://linear.app/neriros/issue/RLF-168/move-push-gh-pr-create-into-the-worker-iteration-hld-parked) should not start until this lands — otherwise we'd be re-forking the path we just reunified.

## Additional instructions

You are working on RLF-169: Revert conflict-fix push to coordinator post-task (consistency).

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
