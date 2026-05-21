# Design for RLF-82

## Files to touch

1. `apps/agent/src/agent/wire/prepare.ts` (≈ line 261-283) — the
   conflict-fix branch of `prepareTaskForTrigger`. Append a `4.` step to
   the prepended fix-task body instructing the worker to push the
   resolved branch and to inspect rejection output inline (force-with-
   lease broken, pre-push hook failure, ref-update policy) and either
   fix-and-retry or stop and surface the reason in the iteration log.

2. `apps/agent/src/agent/post-task.ts` —
   - Add a `mode` field (or equivalent boolean such as
     `isConflictFix`) to `PostTaskInput`. The coordinator already knows
     which trigger spawned the worker; wire it through to post-task.
   - In `runPrPhase` (or a new helper called before it), short-circuit
     when `mode === "conflict-fix"`: - Resolve the PR URL via the existing `findExistingOpenPrUrl`
     helper (or the `registerPr` cache the coordinator already
     populates). If no URL → log + return success (nothing we can do). - Call `fetchPrStatus(prUrl, cmd, cwd)` exactly once. - On `mergeable === "MERGEABLE"`: call the `clearConflicted`
     indicator side-effect (already exported from the indicators
     wiring) and return `0`. - On `mergeable === "CONFLICTING"`: log `! <id>: still CONFLICTING
after rebase; will retry` in yellow and return `0` (success
     from the harness's POV — the next poll will pick it up). - On `mergeable === "UNKNOWN"` or `fetchPrStatus` returning
     `{ kind: "error" }`: log a warning in yellow and return `0`.
   - Do NOT call `createPrWithRetry`, `pushWithLeases`, or the
     `fixConflictsAndCiLoop` `wantConflictLoop` branch when in
     conflict-fix mode.
   - Leave the existing `fresh` / `resume` / `review` path
     (`runPrPhase` → `createPrWithRetry` → `fixConflictsAndCiLoop`)
     unchanged.

3. `apps/agent/src/features/conflict-fix/postTask.ts` — already does
   verification-only via `ctx.caps.conflictFix.getMergeability()`. Keep
   it; this design treats the new `post-task.ts` branch as the
   harness-side equivalent until the legacy arm is fully retired
   (tracked separately by the feature-registry migration). Both paths
   are side-effect-free verifiers so they coexist safely.

4. `apps/agent/src/pr-status.ts` — reuse `fetchPrStatus`. No new
   exports are required; if a `verifyNotConflicted(prUrl)` helper makes
   the call site clearer we can add it as a thin wrapper, but the
   existing `PrStatus` discriminated union already exposes everything
   needed.

## Data flow

```
coordinator.poll()
  └─ trigger = "conflict-fix"
      └─ wire.prepareTaskForTrigger("conflict-fix", changeName)
          └─ prepend fix-task body to tasks.md (now includes step 4: push)
      └─ spawn worker
          └─ AI rebases, resolves, commits, pushes (in-context)
      └─ worker exits
      └─ runPostTask({ mode: "conflict-fix", ... })
          └─ short-circuit branch:
              status = fetchPrStatus(prUrl)
              if MERGEABLE → clearConflicted(issue); return 0
              else        → log; return 0  (next poll picks it up)
```

## Edge cases

- **No PR URL cached.** Possible if the worker is the first iteration
  to push the branch. Resolve via `findExistingOpenPrUrl` after the
  worker exits. If still none, log and return `0` — the conflict-scan
  on the next poll will re-evaluate via the issue's PR detection.
- **fetchPrStatus returns `{ kind: "error" }`.** Treat the same as
  `UNKNOWN`: log a warning, return `0`, let the next poll retry. Do
  not destructively act on a transient gh failure.
- **AI ran `git push` and the push succeeded but the gh API hasn't
  caught up yet.** `fetchPrStatus` may briefly return `UNKNOWN`. The
  fallback ("leave label in place, next poll re-queues") is safe — the
  worst case is one extra conflict-fix iteration that immediately sees
  MERGEABLE and clears the label.
- **AI exits non-zero.** Same handling as any other mode: skip the PR
  phase (`effectiveCode !== 0` already gates the call), label stays,
  next poll re-queues. No special-case needed.
- **`clearConflicted` indicator is not configured.** No-op (the legacy
  arm already tolerates this). Returns `0`.

## Test plan

Tests live under `apps/agent/src/__tests__/` (harness-side) and/or
`apps/agent/src/features/conflict-fix/__tests__/` (feature-side, mirroring
the existing `postTask.test.ts`).

1. **MERGEABLE path.** Stub `fetchPrStatus` to return
   `{ kind: "ok", mergeable: "MERGEABLE", ... }`. Assert
   `clearConflicted` was invoked exactly once and that the harness
   never called `git push` or `pushWithLeases`.
2. **CONFLICTING path.** Stub `fetchPrStatus` to return
   `{ kind: "ok", mergeable: "CONFLICTING", ... }`. Assert
   `clearConflicted` was NOT invoked, the yellow log line was emitted,
   and the function returned `0`.
3. **UNKNOWN / fetch error path.** Stub `fetchPrStatus` to return
   `{ kind: "error", message: "..." }`. Assert no label mutation, no
   push, a warning was logged, and return code is `0`.
4. **Non-conflict modes regression.** Existing post-task tests
   (push retry, hook-fix retry, only-meta recovery) continue to pass
   unchanged when `mode !== "conflict-fix"`.
