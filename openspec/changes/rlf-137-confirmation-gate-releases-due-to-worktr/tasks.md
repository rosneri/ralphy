# Tasks for RLF-137

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-137/confirmation-gate-releases-due-to-worktree-path-mismatch-short and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Add `worktreeDirNameForIssue(issue: { identifier: string }): string` to `apps/agent/src/agent/worktree.ts` returning `issue.identifier.toLowerCase()`. Export it.
- [ ] Update `apps/agent/src/agent/wire/prepare.ts:85` to use `worktreeDirNameForIssue(issue)` instead of the inline `issue.identifier.toLowerCase()` call.
- [ ] Update `apps/agent/src/features/confirmation/awaiting.ts`: change `resolveChangeCwdForIssue` to accept the `issue` (or the short identifier), probe `<worktreesDir>/<worktreeDirNameForIssue(issue)>/openspec/changes/<changeName>/tasks.md` first (canonical), then `<worktreesDir>/<changeName>/openspec/changes/<changeName>/tasks.md` (legacy fallback), then `projectRoot`. Update the call site at `awaiting.ts:140` to pass the issue.
- [ ] Add a regression test in `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts`: create a tmpdir layout where the worktree directory uses the short identifier (`rlf-200`) and the openspec change uses the full slug (`rlf-200-...`); assert the gate stays claimed and does NOT log `tasks-empty`. The test must fail against the current code.
- [ ] Run `bunx openspec validate rlf-137-confirmation-gate-releases-due-to-worktr` and confirm it passes.
- [ ] Run `bun run lint` and fix any issues.
- [ ] Run `bun run test` and confirm all tests pass (including the new regression test).
- [ ] Stage each touched file individually with `git add <path>`, commit with a descriptive message referencing RLF-137, push the branch, and open a PR titled `rlf-137-confirmation-gate-releases-due-to-worktr`.
