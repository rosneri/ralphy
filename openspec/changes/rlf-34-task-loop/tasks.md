# Tasks for RLF-34

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-34/task-loop and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [x] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Update `apps/agent/src/agent/scaffold.ts` so `proposal.md` includes `## Why` (seeded with the Linear description) and `## What Changes` (placeholder italic line) sections, in addition to the existing `## Description` / `## Steering` sections
- [x] Extend the scaffolded `tasks.md` planning checklist to remind the agent to fill in `## Why` / `## What Changes` in proposal.md and to add at least one spec delta under `specs/<capability>/spec.md`
- [x] Add assertions to `apps/agent/src/__tests__/agent.test.ts` that the scaffolded proposal contains `## Why` and `## What Changes` and that the planning tasks mention spec deltas
- [x] In `apps/loop/src/hooks/useLoop.ts`, move `setStopReason(reason)` to the end of the effect — after the final `addInfo("Ralph loop finished …")`, `commitTaskDir`, and `gitPush` — so no `<Static>` items are appended after the dynamic stop block renders
- [x] In `apps/loop/src/components/TaskLoop.tsx`, render the stop block (`StatusBar` + `StopMessage`) only when `!loop.isRunning` so the dynamic stop frame is drawn exactly once
- [x] Add a regression test in `apps/loop/src/__tests__/components.test.tsx` (or a new test file) that asserts `StopMessage` is not rendered while the loop is still running
- [x] Run `bun run lint` and `bun run test` from the repo root; resolve any failures
- [x] Run `bunx openspec validate rlf-34-task-loop` and confirm the change validates (or that any remaining warnings are about spec deltas only — already tracked in the planning tasks)
