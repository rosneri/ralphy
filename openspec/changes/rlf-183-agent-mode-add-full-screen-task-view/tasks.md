# Tasks for RLF-183

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-183/agent-mode-add-full-screen-task-view and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)

## Implementation

- [x] Add `onFocusChange?: (focused: boolean) => void` prop to `SteeringInput` and call it on `onFocus`/`onBlur` of the textarea
- [x] Export pure helper `getAdjacentTask(tasks, current, direction)` from a new file `apps/ui/src/components/FullScreenTaskView.tsx`
- [x] Write unit tests in `apps/ui/src/components/__tests__/FullScreenTaskView.test.ts` for `getAdjacentTask` (empty list, single task, wrap-around prev, wrap-around next, unknown current)
- [x] Build `FullScreenTaskView` component: fixed overlay with full task layout (feed, sidebar, status bar, steering input), task-nav header row, keyboard shortcuts (`ArrowLeft`/`[` prev, `ArrowRight`/`]` next, `Escape`/`f` close), suppress shortcuts when steering input focused
- [x] Add CSS for `.fullscreen-overlay` and `.fullscreen-nav` in `apps/ui/src/styles/global.css`
- [x] Update `TaskDetailView` to call `useTasks()`, remove `SteeringInput` from its default layout, add `f` keydown handler to open fullscreen, render `<FullScreenTaskView>` when `isFullscreen` is true
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and ensure all tests pass
