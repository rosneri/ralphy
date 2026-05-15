# Design for RLF-45

## Files touched

- `apps/agent/src/components/AgentMode.tsx`
  - `useInput` handler (around line 714): swap `key.shift` for `key.meta`
    in the "expand all subtasks" branch. Order matters — the
    `ctrl+meta+t` check must come **before** the plain `ctrl+t` branch
    so holding Alt does not fall through to the pending-tasks toggle.
  - JSDoc on `orderSubtasksForCappedDisplay` (around line 148) and the
    `showAllSubtasks` state declaration (around line 413): update
    references from `Ctrl+Shift+T` to `Ctrl+Alt+T`.
  - Inline hint string (around line 1210): change
    `CTRL+SHIFT+T to expand` to `CTRL+ALT+T to expand`.

## Why `key.meta`?

ink's `useInput` exposes `key.meta` for the Alt / Option modifier (the
escape-prefix mechanic that XTerm-style terminals use). Unlike
`key.shift` on a plain `t`, `key.meta` survives every mainstream
terminal we target. macOS users press `Ctrl+Opt+T`; Linux/Windows users
press `Ctrl+Alt+T`. Both arrive in ink as `{ ctrl: true, meta: true }`
with `input === "t"`.

## Edge cases

- **Steering field focus.** The keybinding handler already short-circuits
  via `steeringFocusedRef.current`, so the new binding remains inert
  while the user is typing into the steering input. No change needed.
- **`Ctrl+T` regression.** The existing `Ctrl+T` (toggle pending tasks)
  branch must not match when Alt is also held. We guarantee this by
  ordering: the `ctrl+meta+t` branch returns before the plain `ctrl+t`
  branch is evaluated.
- **Case-folding.** The original code accepted both `"t"` and `"T"` to
  guard against terminals that uppercase the character when Shift is
  held. With Shift no longer part of the binding the uppercase branch
  is moot, but we keep it for symmetry with `Ctrl+T`.

## Data flow

No state shape changes. `showAllSubtasks` remains a local boolean in
`AgentModeView`, toggled identically — only its trigger keystroke
changes.

## Test strategy

`AgentModeView` is rendered through ink and depends on the
`AgentModeCoordinator` runtime, which makes a focused unit test on the
keybinding heavyweight. The functional change is mechanical (one
modifier swap + three string updates) and gated by ink's documented
`key.meta` semantics, so we rely on:

1. `bun run lint` — catches typos / unused imports.
2. `bun run test` — guards against regressions in nearby pure helpers
   (`orderSubtasksForCappedDisplay`, etc.) whose JSDoc we touched.
3. Manual smoke check captured as an Implementation task: run
   `ralph agent`, queue enough subtasks to trigger the `+N more` hint,
   confirm `Ctrl+Opt+T` toggles the expanded view and `Ctrl+T` still
   toggles the pending-tasks panel.
