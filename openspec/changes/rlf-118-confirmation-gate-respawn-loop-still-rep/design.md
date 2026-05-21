# Design for RLF-118

## Goal

Stop the confirmation feature from silently surrendering its claim on later polls when no human signal has arrived. Surface enough on-disk evidence that the next reproducer pinpoints the underlying branch instead of needing a third Linear ticket.

## Files touched

- `apps/agent/src/features/confirmation/awaiting.ts` — every `return false` site gets a one-line `onLog` call naming the branch. The whole body is wrapped in a top-level try/catch; on throw, log the issue identifier + error message and `return true` (preserve the claim).
- `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts` (new) — regression test covering the second-poll-resume path against the real `processAwaitingForIssue`. Uses a tmpdir to mount a synthetic worktree with `tasks.md` and `.ralph-state.json` pre-seeded as the bug snapshot, then injects a fake config + indicators + Linear adapter that returns no approval, no comments. Asserts the function returns `true`, the awaiting set still contains the change, and the `reapForAwaiting` callback fires (idempotent — the worker is already gone).
- `openspec/changes/rlf-118-.../specs/confirmation-mode/spec.md` — the spec delta adds the claim-stability requirement and two scenarios.

## Data flow

`processAwaitingForIssue` runs once per in-progress issue per poll, from the coordinator's `walkRegistryForInProgress`. The new top-level try/catch sits at the outermost boundary, so any throw from `readConfirmationState`, `gateActive`/`hasUnchecked`, `postPlanReadyCommentOnce`, `inspectAwaitingTicket` (the user-suspected source of terminal outcome flips on later polls), or the trailing `writeConfirmationState` lands in the outer catch with a log line and a `true` return. The `reapForAwaiting` side effect runs before inspect today, so the worker (if any) is already dead by the time a throw could happen mid-inspect — the only consequence of returning `true` on throw is that the coordinator skips re-enqueuing the ticket as `resume` this tick.

## Log format

Each branch emits its line through `deps.onLog`. Format:

```
  <issue.identifier>: confirmation detect released — <branch>
```

`<branch>` is one of: `disabled`, `gate-cleared`, `tasks-empty`, `outcome=approved`, `outcome=revised`. The throw path uses a separate yellow line:

```
! confirmation detect threw for <issue.identifier>: <message>
```

## Edge cases

- **Throw before `readConfirmationState`**: the try/catch wraps the entire function, including the early `cfg.linear.confirmationMode.enabled` check. If even that throws (pure boolean access today), we still log and return `true`.
- **`reapForAwaiting` invoked twice across polls**: already idempotent in the coordinator — the `reapedForAwaiting` flag short-circuits the second call.
- **`postPlanReadyCommentOnce` posts a duplicate comment**: guarded by `if (confirmation?.askedAt) return` — unchanged.
- **State file missing on poll 3 (worktree pruned)**: `readConfirmationState` returns the default shape. `gateActive` returns `true`, `hasUnchecked` is `false` (no tasks.md). Branch fires `tasks-empty`, log emitted, return `false`. Intended behavior.

## Test strategy

- New `awaiting.test.ts` exercises `processAwaitingForIssue` directly. A tmpdir hosts a synthetic worktree with `openspec/changes/<name>/tasks.md` (unchecked items) and `.ralph/tasks/<name>/.ralph-state.json` pre-seeded as the bug snapshot. The Linear-adapter deps return no approval, no comments. Asserts the function returns `true` and the awaiting set is non-empty after the call.
- A second test forces a throw inside `processAwaitingForIssue` by stubbing `deps.cwdOf` to throw. Asserts the function returns `true` and the `onLog` channel observed the throw line.
- Re-run `bun run lint` and `bun run test` to make sure no existing test relies on `processAwaitingForIssue` returning `false` on throw.

## Rollout

Behavior-only changes inside the confirmation feature; no schema, no config, no Linear API surface area. Safe to ship under `ralph:auto-merge` once tests pass.
