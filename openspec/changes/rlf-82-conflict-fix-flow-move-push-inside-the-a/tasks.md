# Tasks for RLF-82

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-82/conflict-fix-flow-move-push-inside-the-ai-iteration-post-task-only and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Extend the `conflict-fix` branch of `prepareTaskForTrigger` in `apps/agent/src/agent/wire/prepare.ts` to append a step 4 instructing the worker to `git push` the resolved branch and to react to rejection output (force-with-lease broken, pre-push hook failure, ref-update policy) inline before retrying or stopping.
- [ ] Thread a `mode` (or `isConflictFix`) field through `PostTaskInput` in `apps/agent/src/agent/post-task.ts` and update the coordinator call site so post-task knows when it is running a conflict-fix iteration.
- [ ] In `runPostTask` / `runPrPhase`, add a short-circuit for `mode === "conflict-fix"` that resolves the PR URL (using the existing PR-URL cache or `findExistingOpenPrUrl`), calls `fetchPrStatus` exactly once, and dispatches on `MERGEABLE` / `CONFLICTING` / `UNKNOWN` (or fetch error) as specified in the spec delta. Ensure no `git push`, `createPrWithRetry`, `pushWithLeases`, or `fixConflictsAndCiLoop` call happens in this branch.
- [ ] Wire `clearConflicted` invocation on the `MERGEABLE` path through the existing indicator side-effect surface (no new label-mutation helper).
- [ ] Verify `fresh` / `resume` / `review` paths remain on the legacy push + hook-fix retry harness; if needed, gate the legacy branch with an explicit `mode !== "conflict-fix"` check rather than removing code.
- [ ] Add unit tests under `apps/agent/src/__tests__/` (or `apps/agent/src/features/conflict-fix/__tests__/`) covering the MERGEABLE, CONFLICTING, and UNKNOWN/error exit paths with stubbed `fetchPrStatus`.
- [ ] Add a regression test asserting that for `mode !== "conflict-fix"` the legacy `createPrWithRetry` / `pushWithLeases` path is still invoked (or that existing post-task tests continue to pass against the new mode-gated code).
- [ ] Run `bun run lint` and fix any reported issues.
- [ ] Run `bun run test` and ensure the full suite passes.
- [ ] Run `bunx openspec validate rlf-82-conflict-fix-flow-move-push-inside-the-a` and resolve any validator errors.
