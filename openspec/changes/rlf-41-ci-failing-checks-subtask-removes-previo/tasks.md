# Tasks for RLF-41

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-41/ci-failing-checks-subtask-removes-previous-tasks and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Add a spec delta under `specs/agent-mode-subtasks/spec.md` describing the new SUBTASKS-panel ordering requirement
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan

## Implementation

- [x] Add `orderSubtasksForCappedDisplay()` next to `parseSubtasks` in `apps/agent/src/components/AgentMode.tsx` that partitions subtasks into `[pending, done]` (stable file order within each group).
- [x] Use `orderSubtasksForCappedDisplay()` when computing the capped slice in the SUBTASKS panel render. The expanded (`Ctrl+Shift+T`) view still renders subtasks in literal file order.
- [x] Extend `apps/agent/src/__tests__/pending-tasks.test.ts` with cases covering the partition order, empty input, all-pending input, all-done input, and a freshly prepended Fix-failing-CI scenario that simulates 16 completed items above 2 unchecked items and verifies the cap-15 slice keeps both unchecked tasks visible.
- [x] Run `bun run lint` and fix any issues it reports.
- [x] Run `bun run test` and confirm the new tests pass with no regressions and no coverage-threshold reduction.
- [x] Run `bunx openspec validate rlf-41-ci-failing-checks-subtask-removes-previo` and resolve any reported issues.

## Manual Testing

- [ ] Run the agent dashboard (`bun run dev` or `ralph agent`) against a worker whose `tasks.md` has accumulated more than 15 completed items above one unchecked item; confirm the SUBTASKS panel shows the unchecked item at row 1 with the `+N more` ellipsis below.
- [ ] Trigger a CI failure on an open PR (or hand-craft `tasks.md` to mimic post `prependFixTask("Fix failing CI checks", …)`) and confirm the freshly-added `[ ] Fix failing CI checks…` row appears at the top of the SUBTASKS panel, with prior unchecked mission tasks still visible below it.
- [ ] Press `Ctrl+Shift+T` to expand the SUBTASKS panel and confirm the items render in literal file order (no reorder, no cap) — completed items appear interleaved with pending items as they sit in the file.
- [ ] Press `Ctrl+T` to collapse the panel and confirm the reorder + cap reappears.
- [ ] Edge case: a `tasks.md` with all items completed still renders the panel unchanged (no regression — full list, no ellipsis until past 15 items).
- [ ] Edge case: a `tasks.md` with only Planning items renders no SUBTASKS rows (since `parseSubtasks` skips the Planning section).
