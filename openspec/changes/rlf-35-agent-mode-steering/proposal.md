# RLF-35: Agent mode steering

Source: [RLF-35](https://linear.app/neriros/issue/RLF-35/agent-mode-steering)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:error

## Problem

The agent dashboard surfaces every worker's task, subtasks, and tail output, but
the operator has no in-TUI way to inject guidance into a running loop. The only
"steer" path today is the UI sidecar's `/steer` HTTP route used by the desktop
UI; from the terminal dashboard, the operator must drop out, write to
`openspec/changes/<name>/steering.md` by hand, and trust the next iteration to
pick it up. That breaks the flow of watching the loop and steering it in
real time.

## Approach

- Render a single-row labelled steering input at the bottom of the focused
  worker card in agent mode (`╭─ STEER (CTRL+S) ─╮ … ╰──╯`).
- `Ctrl+S` toggles focus on the field. While focused: printable characters
  append to the buffer, `Backspace`/`Delete` remove the char before the cursor,
  arrows move the cursor, `Esc` cancels (clears + blurs), and `Enter` submits a
  trimmed non-empty buffer.
- On submit, append the message to `openspec/changes/<changeName>/steering.md`
  via the existing `appendSteeringMessage` helper from `@ralphy/core/loop`,
  wrapped in a default `runWithContext` scope (mirroring the sidecar's
  `/steer` route so storage helpers see an active AsyncLocalStorage context).
- While the field is focused, all worker-navigation shortcuts (`1`-`9`, `Tab`,
  arrow keys, `Ctrl+T`) are suppressed so the keystrokes flow into the buffer
  instead of jumping workers or toggling the subtasks panel.
- After submit, flash a transient `steered → next iteration` hint for ~2s in
  place of the `CTRL+S to steer` placeholder. On failure, log a red line and
  flash `send failed`.
- Persist buffer / cursor / focus in refs on `AgentMode` so the field's state
  survives the `resizeKey`-driven remount of its parent `Box`.
- Account for the field's three rows in `FIXED_OVERHEAD` so the focused tail
  region shrinks correctly when the field is rendered.

## Acceptance criteria

- A `╭─ STEER (CTRL+S) ─╮` titled box renders at the bottom of the focused
  worker card whenever at least one worker is active.
- `Ctrl+S` toggles the field's focus; the border switches from gray to yellow
  while focused, and the placeholder is hidden in favour of the buffer + cursor.
- Printable keys append to the buffer; `Backspace`/`Delete` shrink it; left/
  right arrows move the cursor; `Esc` blurs + clears.
- `Enter` on a non-empty trimmed buffer calls the injected `appendSteering`
  (real impl: `appendSteeringMessage` against `openspec/changes/<name>/steering.md`).
  Empty / whitespace-only `Enter` is a no-op.
- After a successful submit the placeholder flashes `steered → next iteration`
  (green) for ~2s then returns to `CTRL+S to steer`. On error it flashes
  `send failed` (red) and a red log line is emitted.
- While the field is focused, digit shortcuts (`1`-`9`), `Tab`, arrow keys
  and `Ctrl+T` do NOT switch workers / toggle subtasks; they feed the buffer.
- Resizing the terminal does not blank the buffer or drop focus.
- Unit tests cover the `SteeringField` component (focus toggle, char capture,
  backspace, Esc, Enter on empty buffer, Enter on non-empty buffer) and an
  integration test in `AgentMode` covers Ctrl+S + chars + Enter dispatching
  to the injected `appendSteering`.
- `bun run lint`, `bunx nx run agent:test`, and
  `bunx openspec validate rlf-35-agent-mode-steering` all pass.

## Steering

_Add steering notes here as the loop runs._
