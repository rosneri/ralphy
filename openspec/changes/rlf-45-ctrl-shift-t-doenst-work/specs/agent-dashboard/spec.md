# agent-dashboard — Expand-subtasks keybinding

## MODIFIED Requirements

### Requirement: Expanded subtasks view MUST be toggled by Ctrl+Alt+T

The agent dashboard MUST bind its "expand all subtasks over the OUTPUT feed" toggle to `Ctrl+Alt+T` (delivered by ink as `{ ctrl: true, meta: true }` with `input === "t"`). The previous binding
`Ctrl+Shift+T` MUST be removed because mainstream terminals either
intercept it (e.g. iTerm2's "new tab") or fail to deliver the shift
modifier alongside a plain-ASCII character, leaving the shortcut
inert.

`Ctrl+T` (toggle the SUBTASKS panel) MUST remain unchanged and MUST NOT
fire when `Alt` is also held — the `ctrl+alt+t` branch must be
evaluated before the plain `ctrl+t` branch in the `useInput` handler.

The truncated subtask list's "+N more" footer hint MUST read
`(CTRL+ALT+T to expand)`.

The expand toggle MUST remain inert while the steering input is
focused, matching the behaviour of all other dashboard shortcuts.

#### Scenario: Ctrl+Alt+T expands the subtask list

- **Given** an active worker whose subtask list exceeds the capped display
- **When** the operator presses `Ctrl+Alt+T` (Opt+T on macOS)
- **Then** the subtasks panel renders every task in literal file order, no `+N more` footer

#### Scenario: Ctrl+Alt+T collapses an expanded subtask list

- **Given** the subtasks panel is currently expanded via `Ctrl+Alt+T`
- **When** the operator presses `Ctrl+Alt+T` again
- **Then** the panel returns to the capped display with the `(CTRL+ALT+T to expand)` hint

#### Scenario: Ctrl+T still toggles the pending-tasks panel independently

- **Given** an active worker
- **When** the operator presses `Ctrl+T` without `Alt`
- **Then** only the SUBTASKS panel visibility toggles, the expanded view state is unchanged

#### Scenario: Ctrl+Shift+T is no longer wired to the expand toggle

- **Given** an active worker whose subtask list exceeds the capped display
- **When** the operator presses `Ctrl+Shift+T`
- **Then** the dashboard does NOT enter the expanded view (the legacy binding is intentionally removed)
