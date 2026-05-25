# Tasks for RLF-149

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-149/mergability-unknown and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Fix `apps/agent/src/agent/wire/pr-discovery.ts`: remove the immediate `return` on error in the mergeability retry loop so transient errors (HTTP 502) are retried instead of aborting
- [x] Fix `apps/agent/src/agent/post-task.ts`: add `_mergeabilityUnknownRetryDelayMs` to `PostTaskDeps` and add a retry loop (up to 3 retries) for UNKNOWN mergeability in the conflict-fix verify path
- [x] Update `apps/agent/src/__tests__/post-task-conflict-fix.test.ts`: extend `makeCmd` to support per-call response sequences, update the UNKNOWN test to assert 4 `gh pr view` calls, and add an UNKNOWN→MERGEABLE-after-retries test
- [x] Run `bun test apps/agent/src/__tests__/` and confirm all tests pass
- [x] Run `bun run lint` and confirm no new errors
