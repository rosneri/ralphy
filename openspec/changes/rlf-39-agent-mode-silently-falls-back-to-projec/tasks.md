# Tasks for RLF-39

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-39/agent-mode-silently-falls-back-to-projectroot-when-worktree-creation and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] In `apps/agent/src/agent/wire.ts` `setupWorktree()`, rethrow on `createWorktree()` failure when `useWorktree: true` and log the failure in red instead of yellow.
- [x] Add a unit test `apps/agent/src/__tests__/wire-setup-worktree.test.ts` that uses `buildAgentCoordinator` with `useWorktree: true` and a failing `GitRunner`, asserting `prepare()` rejects and no scaffolding lands in `projectRoot`.
- [x] Run `bun run lint` and fix any issues.
- [x] Run `bun test apps/agent/src` and ensure all agent tests pass (full-suite run has pre-existing unrelated `Bun.spawnSync`-mock flakes on baseline; agent package is green).
- [x] `bunx openspec validate rlf-39-agent-mode-silently-falls-back-to-projec` and commit all changed files.
