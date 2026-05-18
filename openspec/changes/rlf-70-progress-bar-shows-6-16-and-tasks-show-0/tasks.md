# Tasks for RLF-70

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-70/progress-bar-shows-616-and-tasks-show-010 and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `apps/agent/src/components/AgentMode.tsx`, replace the `countProgress(tasksText)` call (around line 663) with a derivation from the already-parsed `subtasks` array: `total = subtasks.length`, `checked = subtasks.filter(s => s.done).length`, and set `meta.taskProgress = total > 0 ? { checked, total } : null`.
- [x] Remove the now-unused `import { countProgress } from "@ralphy/core/progress";` line in `AgentMode.tsx` if no other call remains in the file.
- [x] Add a regression test under `apps/agent/src/__tests__/` (extend `pending-tasks.test.ts` or add a new file) that constructs a `tasks.md` containing `## Planning` (6 `- [x]`), `## Implementation` (10 `- [ ]`), and a `## Fix failing CI checks (…)` flow section (1 `- [ ]`), and asserts that the derived `taskProgress` matches the filtered subtasks (i.e. `{ checked: 0, total: 10 }`, not `{ checked: 6, total: 17 }`).
- [x] Run `bun run lint` and fix any new findings.
- [x] Run `bun run test` (or at minimum the affected `apps/agent` test target) and ensure it passes.
- [x] Run `bunx openspec validate rlf-70-progress-bar-shows-6-16-and-tasks-show-0` and ensure it passes.
