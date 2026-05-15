# RLF-24: Preserve UI state on terminal resize

Source: [RLF-24](https://linear.app/neriros/issue/RLF-24/preserve-ui-state-on-terminal-resize)
Status: In Progress
Labels: ralph:auto-merge

## Problem

When the user resizes their terminal while `ralph task` is running, the Ink-based TUI ends up in a visibly broken state: the status bar separator (a hard-coded 52-char `─` rule), wrapped log lines, and the steer prompt overlap or render at stale positions. The previously-emitted scrollback lines (from `<Static>`) were laid out for the old column count, and Ink's live region keeps drawing relative to a row count that no longer matches reality.

## Approach

Hook into the terminal resize signal (`process.stdout` `"resize"` event / `SIGWINCH`) inside the running TUI:

1. Provide a small `useTerminalSize()` React hook that tracks `{ columns, rows }` and updates on resize.
2. In `TaskLoop`, on every resize:
   - Clear the screen + scrollback with the standard ANSI sequence (`\x1b[2J\x1b[3J\x1b[H`) via `useStdout().write(...)`.
   - Bump a `resizeKey` and use it as the React `key` on the root `<Box>` so the entire subtree (including `<Static>`) is remounted and the log feed is re-emitted at the new width.
3. Make the `StatusBar` separator width responsive to the current terminal width (cap at the previous 52 chars to avoid regressions in narrow terminals).

This re-renders all components — status box, logs, steer prompt — exactly as they were, but laid out for the new terminal size.

## Acceptance criteria

- After resizing the terminal (wider or narrower), the entire UI redraws cleanly with no overlapping/misaligned content.
- The full log history that was visible before the resize is preserved (re-emitted), not lost.
- The status bar separator scales to the new width (capped at 52).
- The steer input remains usable after a resize.
- No regression when the terminal is not resized (single render path is unchanged).
- New unit tests cover the resize hook (subscribe / unsubscribe / size update).
- `bun run lint` and `bun run test` pass.
