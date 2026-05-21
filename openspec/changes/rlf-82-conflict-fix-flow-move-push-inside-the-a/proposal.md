# RLF-82: Conflict-fix flow: move push inside the AI iteration; post-task only verifies

Source: [RLF-82](https://linear.app/neriros/issue/RLF-82/conflict-fix-flow-move-push-inside-the-ai-iteration-post-task-only)
Status: Todo
Labels: ralph:auto-merge, ralph:approved

## Why

Today the conflict-fix flow is split across two entry points: the AI worker
rebases + resolves + commits (no push), and the post-task harness
(`apps/agent/src/agent/post-task.ts::fixConflictsAndCiLoop`, `pushWithLeases`)
does the `git push --force-with-lease` and re-spawns the worker under a
"fix the pre-push hook" fix task when the push is rejected.

That harness-driven retry loses provenance: when the push fails for a more
interesting reason than a hook (force-with-lease broken because someone
else pushed to the branch, ref-update policy rejection, main moved
mid-rebase), the AI is re-entered from a different prompt that no longer
sees the original conflict-fix context. The AI cannot inspect `git push`
stderr, the remote state, or the freshly-fetched ref.

We want push failures to land in the AI's own context so it can react,
and we want post-task to do one cheap verification per iteration instead
of owning a separate retry harness.

## What Changes

- Extend the conflict-fix fix-task body prepended in
  `apps/agent/src/agent/wire/prepare.ts` (around line 261-283) with a new
  step 4 that instructs the worker to push the resolved branch and to
  inspect any rejection inline before retrying or surfacing the reason.
- In `apps/agent/src/agent/post-task.ts`, thread a `mode` (or equivalent
  "is this a conflict-fix iteration" signal) into `runPostTask`/`runPrPhase`
  and short-circuit the push + hook-fix retry path for conflict-fix mode.
  Replace it with a single `fetchPrStatus(prUrl)` call that:
  - on `mergeable === "MERGEABLE"` → runs the existing `clearConflicted`
    indicator and returns success;
  - on `mergeable === "CONFLICTING"` → logs and leaves the
    `ralph:conflict` label in place so the next poll's conflict-scan
    re-queues the ticket with the same context;
  - on `mergeable === "UNKNOWN"` (or fetch error) → logs and leaves
    state untouched (no destructive action, no re-push).
- Keep the existing `fresh` / `resume` / `review` modes on the legacy
  push + hook-fix retry path — no regression for the non-conflict modes.
- Reuse the `fetchPrStatus` helper in `apps/agent/src/pr-status.ts`. A
  thin `verifyNotConflicted(prUrl)` wrapper may be introduced if it
  simplifies the call site, but it must not duplicate gh queries.
- Cover three exit paths with tests under `apps/agent/src/__tests__/`
  and/or `apps/agent/src/features/conflict-fix/__tests__/`:
  1. AI commits + pushes → next status is `MERGEABLE` → `clearConflicted`
     fires and label is removed.
  2. AI commits but push failed → status stays `CONFLICTING` → label
     stays in place; no fix-task is queued by post-task.
  3. AI commits + pushes but main moved mid-rebase → status is still
     `CONFLICTING` → label stays in place; next poll re-queues.

## Acceptance

- [ ] Conflict-fix worker's fix-task body includes the push step.
- [ ] `post-task.ts` does not push for conflict-fix mode.
- [ ] `post-task.ts` calls `fetchPrStatus` exactly once per conflict-fix iteration.
- [ ] On `MERGEABLE` → `clearConflicted` runs; the ticket leaves the
      `getConflicted` bucket on the next poll.
- [ ] On still-`CONFLICTING` → log + leave label in place; next poll re-queues.
- [ ] No regression on `fresh` / `resume` / `review` modes — they still
      get the push + hook-fix retry harness.
- [ ] Tests cover all three exit paths.

## Non-goals

- Removing the hook-fix retry harness entirely. It still applies to
  non-conflict modes where the AI has already considered itself done.
- Changing how the conflict scan detects PRs (separate concern; see
  [RLF-81](https://linear.app/neriros/issue/RLF-81/auto-apply-ralphconflict-label-when-finished-pr-is-blocked-by-merge)).
- Auto-rebase via `gh pr update-branch`. Server-side rebase fails on
  actual conflicts and gives the AI no signal, so it cannot replace this
  refactor.

## Steering

_Add steering notes here as the loop runs._
