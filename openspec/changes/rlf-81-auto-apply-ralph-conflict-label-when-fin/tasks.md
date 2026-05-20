# Tasks for RLF-81

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-81/auto-apply-ralphconflict-label-when-finished-pr-is-blocked-by-merge and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `CoordinatorDeps.isChangeArchivedForIssue` (optional) to `apps/agent/src/agent/coordinator.ts` and import `markersOf` from `@ralphy/types`.
- [x] Add a process-scoped `conflictPromoted: Set<string>` field to `AgentCoordinator` and clear it from `notifyExited` whenever a `conflict-fix` worker exits successfully.
- [x] Implement `maybePromoteFinishedConflicted(issue)` on `AgentCoordinator` per the spec (archived check → label check → PR status check → applyIndicator + one-shot comment).
- [x] Add helper `extractPrNumber(url)` and `issueHasIndicator(issue, ind)` (case-insensitive label match) in `coordinator.ts`.
- [x] Wire the promotion check into the in-progress loop in `pollOnce` so promoted tickets skip the `resume` queue push.
- [x] Implement `isChangeArchivedForIssue` in `apps/agent/src/agent/wire.ts` using `readdir` (`node:fs/promises`, async) against `openspec/changes/archive/`, matching either `<changeName>` or `*-<changeName>` entries; wire it into the coordinator deps.
- [x] Extend the test fixture in `apps/agent/src/__tests__/coordinator.test.ts` with an `archivedIssues: Set<string>` and an `isChangeArchivedForIssue` stub.
- [x] Add coordinator tests covering: promotion (finished + CONFLICTING + no label), idempotency across two polls, MERGEABLE PR continues to resume, and "no archive entry" continues to resume.
- [x] Run `bun run lint` and `bun test` and ensure both pass (lint warnings unchanged; no test regressions).
- [x] Run `bunx openspec validate rlf-81-auto-apply-ralph-conflict-label-when-fin --strict` and resolve any errors before committing.
