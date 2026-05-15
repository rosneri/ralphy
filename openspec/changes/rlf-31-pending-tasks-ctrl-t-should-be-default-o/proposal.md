# RLF-31: Pending tasks ctrl t should be default on

Source: [RLF-31](https://linear.app/neriros/issue/RLF-31/pending-tasks-ctrl-t-should-be-default-on)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Problem

In the agent dashboard worker card, the subtasks panel is hidden by default and the user must press Ctrl+T to reveal it. The hint surfaces in an awkward spot in the card header, the section title still says "PENDING TASKS", and the panel only lists unchecked items — so the user can't see which subtasks are already done. The progress bar always sits near the top of the card, regardless of whether the panel is open.

## Approach

- Default `showPendingTasks` to `true` so the subtasks panel is visible on startup.
- Rename the section header from `PENDING TASKS (N)` to `SUBTASKS (N)`.
- Show every task (done and pending) with a `[x]` / `[ ]` prefix; pull all items from `tasks.md`, not just unchecked ones.
- Move the progress bar to the bottom of the card, and only render it when the subtasks panel is closed. When open, the panel itself communicates progress.
- Place the `CTRL+T` hint next to the section title when the panel is open (`SUBTASKS (10)  CTRL+T to close`) and next to the `#/#` count inside the progress bar when it is closed (`CTRL+T to open`). Remove the redundant `Ctrl+T tasks` segment from the card header.

## Acceptance criteria

- On dashboard launch with at least one active worker, the subtasks panel is open by default.
- The panel header reads `SUBTASKS (N) CTRL+T to close`.
- The panel lists all tasks from `tasks.md`, each prefixed with `[x] ` or `[ ] ` matching the checkbox state, in document order.
- The progress bar is rendered at the bottom of the card and only when the panel is closed; the inline `#/#` is followed by a dim `CTRL+T to open` hint.
- The previous `Ctrl+T tasks ▼` segment in the card header is gone.
- Ctrl+T still toggles the panel for every worker card simultaneously (existing behaviour).
- Unit tests cover the new "list all tasks" parser; existing parser tests stay green or are replaced.
- `bun run lint` and `bun run test` pass.

## Steering

_Add steering notes here as the loop runs._
