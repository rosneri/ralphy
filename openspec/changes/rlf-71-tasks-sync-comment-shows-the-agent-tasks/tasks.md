# Tasks for RLF-71

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-71/tasks-sync-comment-shows-the-agent-tasks and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [x]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Update `renderTasksBlock` in `apps/agent/src/agent/linear-sync/index.ts` to filter sections whose heading is `Planning` (case-insensitive, trimmed) before rendering, and to emit `_No mission tasks yet — planning in progress._` when no sections remain
- [x] Update the existing multi-section test in `apps/agent/src/__tests__/linear-tasks-sync.test.ts` that currently asserts `**Planning**` appears, so it instead asserts the Planning section is filtered out
- [x] Add a test in `apps/agent/src/__tests__/linear-tasks-sync.test.ts` covering the Planning-only placeholder rendering (placeholder string present, markers + footer intact, no Planning bullets)
- [x] Add a test in `apps/agent/src/__tests__/linear-tasks-sync.test.ts` covering case-insensitive heading filtering (`## planning`, `## PLANNING`)
- [x] Run `bunx openspec validate rlf-71-tasks-sync-comment-shows-the-agent-tasks` and confirm it passes
- [x] Run `bun run lint` from the repo root and fix any new findings
- [x] Run `bun run test` from the repo root and confirm all tests pass
