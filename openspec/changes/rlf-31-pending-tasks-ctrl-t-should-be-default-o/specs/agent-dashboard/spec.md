# agent-dashboard — Subtasks panel default-on

## ADDED Requirements

### Requirement: Subtasks panel MUST be open by default and list every task

The agent dashboard worker card MUST render the subtasks panel by default for
every active worker, without requiring the operator to press Ctrl+T first.

The panel header MUST read `SUBTASKS (N)` (not `PENDING TASKS`) where `N` is
the total number of `- [x]` and `- [ ]` items parsed from `tasks.md`, followed
by a dim `CTRL+T to close` hint.

The panel MUST list every task in document order. Each row MUST be prefixed
with `[x] ` when the source line is `- [x]` and `[ ] ` when the source line is
`- [ ]`. Completed rows MUST be rendered dim so they read as background context.

Ctrl+T MUST continue to toggle the panel for all worker cards simultaneously.

#### Scenario: dashboard opens with the subtasks panel already visible

- **Given** a dashboard launches with at least one active worker whose `tasks.md` has any `- [ ]` or `- [x]` items
- **When** the operator first sees the dashboard
- **Then** the worker card renders `─ SUBTASKS (N) CTRL+T to close ──` followed by every task line

#### Scenario: completed tasks are visible with check prefix

- **Given** a worker's `tasks.md` contains `- [x] alpha` then `- [ ] beta` then `- [x] gamma`
- **When** the subtasks panel is rendered
- **Then** the panel lists, in order, `[x] alpha`, `[ ] beta`, `[x] gamma`
- **And** the `[x]` rows are rendered dim while the `[ ]` row is rendered normal

### Requirement: progress bar MUST move to the card bottom and only show when the panel is closed

The task progress bar MUST be rendered at the bottom of the worker card, after
the output tail, instead of directly under the card header.

The progress bar MUST render only when the subtasks panel is closed. When the
panel is open, the panel itself communicates progress and the bar is omitted.

When the progress bar is rendered, a dim `CTRL+T to open` hint MUST appear
immediately after the `#/#` count so the operator can re-open the panel.

The previous `│ Ctrl+T tasks ▼` segment in the worker card header MUST be
removed; the Ctrl+T hint lives only in the two locations above.

#### Scenario: closing the subtasks panel reveals the bottom progress bar

- **Given** the subtasks panel is open and a worker has `taskProgress = { checked: 2, total: 5 }`
- **When** the operator presses Ctrl+T
- **Then** the subtasks panel disappears from every worker card
- **And** the worker card renders a progress bar at the bottom containing `2/5` followed by a dim `CTRL+T to open` hint
- **And** the card header no longer contains a `Ctrl+T tasks` segment

#### Scenario: opening the panel hides the progress bar

- **Given** the subtasks panel is closed and the progress bar is visible at the bottom of the card
- **When** the operator presses Ctrl+T
- **Then** the progress bar disappears
- **And** the subtasks panel appears with `CTRL+T to close` in its header
