# Tasks for RLF-31

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-31/pending-tasks-ctrl-t-should-be-default-on and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Replace `parsePendingTasks` in `apps/agent/src/components/AgentMode.tsx` with `parseSubtasks(tasksMd): Array<{ done: boolean; text: string }>` that returns every `- [x]` / `- [ ]` line in document order
- [x] Update `WorkerMeta` to store `subtasks: Array<{ done: boolean; text: string }>` and adjust the initial empty state plus the polling loop assignment so `currentTask` becomes the first item with `done === false`
- [x] Default `showPendingTasks` `useState` to `true` so the SUBTASKS panel is open on launch
- [x] Remove the `│ Ctrl+T tasks …` segment from the worker card header
- [x] Rename the panel header to `SUBTASKS (N)` and append `CTRL+T to close`; render each subtask with `[x] ` (dim) or `[ ] ` (normal) prefix and keep the `MAX_PENDING_DISPLAY` cap
- [x] Move the task progress bar to the bottom of the card and render it only when `showPendingTasks` is false; append a dim `CTRL+T to open` hint after the `#/#` count
- [x] Rewrite `apps/agent/src/__tests__/pending-tasks.test.ts` to cover `parseSubtasks` (ordered done+pending entries, ignores non-task lines, trims whitespace, empty input)
- [x] Run `bun run lint` and fix any findings
- [x] Run `bun run test` and fix any failures
- [x] Run `bunx openspec validate rlf-31-pending-tasks-ctrl-t-should-be-default-o`
