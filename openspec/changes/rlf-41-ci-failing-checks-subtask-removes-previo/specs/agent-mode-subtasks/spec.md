# agent-mode-subtasks — unchecked-first ordering in the capped SUBTASKS panel

## ADDED Requirements

### Requirement: SUBTASKS panel MUST surface unchecked items above completed items in the capped view

The capped SUBTASKS panel MUST render unchecked items (`- [ ]`) before completed items (`- [x]`), preserving file order within each group, before applying the `MAX_PENDING_DISPLAY` cap. This guarantees that
a freshly prepended `Fix failing CI checks` task — and any previously unchecked
mission tasks — remain visible even after iterations have accumulated long
runs of completed items.

The expanded view (toggled with `Ctrl+Shift+T`) MUST still render every subtask
in file order without the cap or the reorder, so the operator can inspect the
literal `tasks.md` structure for diagnostics.

#### Scenario: a freshly prepended Fix failing CI checks task appears at the top of a capped panel

- **Given** `tasks.md` has 16 `- [x]` completed items followed by a freshly prepended `## Fix failing CI checks` section with one `- [ ] Fix failing CI checks…` item
- **When** the SUBTASKS panel renders in its default (capped) mode
- **Then** row 1 is the `- [ ] Fix failing CI checks…` item
- **And** the `+N more (CTRL+SHIFT+T to expand)` ellipsis truncates only completed items

#### Scenario: previous unchecked mission tasks remain visible after a CI fix task is prepended

- **Given** `tasks.md` has a `## Implementation` section with 2 unchecked items and 14 completed items, and a freshly prepended `## Fix failing CI checks` with 1 unchecked item
- **When** the SUBTASKS panel renders in its default (capped) mode
- **Then** rows 1–3 are the 3 unchecked items (newest first by file order)
- **And** the ellipsis hides only completed items

#### Scenario: expanded view renders every item in file order

- **Given** any `tasks.md` content
- **When** the operator presses `Ctrl+Shift+T` to expand the SUBTASKS panel
- **Then** the panel renders every parsed subtask in file order, including completed items, with no cap and no reorder
