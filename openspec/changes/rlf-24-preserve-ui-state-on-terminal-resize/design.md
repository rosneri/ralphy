# Design for RLF-24

## Why the UI breaks today

The TUI is Ink + React (`apps/loop/src/components/TaskLoop.tsx`):

- Log lines are rendered inside an `<Static items={feedItems}>` block. Ink writes Static items to scrollback once and never touches them again.
- The dynamic region (`StatusBar`, `SteerInput`, `StopMessage`) is drawn below Static via `log-update`, which tracks how many rows its previous output occupied to know how many to clear before the next paint.

When the terminal is resized:

- Lines previously written into scrollback were wrapped for the _old_ column count and stay that way in the user's terminal — they don't reflow.
- Ink's row-count bookkeeping for the dynamic region is now wrong relative to the new viewport, so the next paint over-/under-clears, producing overlap with the static log and a "broken" frame.
- `StatusBar` uses a hard-coded `"─".repeat(52)` separator, which is independent of width and looks wrong after a wide-to-narrow resize.

## Files to touch

| File                                                            | Change                                                                                                                                                                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/loop/src/hooks/useTerminalSize.ts` _(new)_                | React hook that subscribes to `process.stdout` `"resize"` and returns `{ columns, rows }` plus a monotonic `resizeKey`.                                                                              |
| `apps/loop/src/components/TaskLoop.tsx`                         | Use the hook; on resize, write the clear-screen ANSI sequence via `useStdout().write(...)` and key the root `<Box key={resizeKey}>` so the Static feed is remounted and re-emitted at the new width. |
| `apps/loop/src/components/StatusBar.tsx`                        | Compute separator width from the current `columns` (capped at 52, min 8 for very narrow terminals).                                                                                                  |
| `apps/loop/src/hooks/__tests__/useTerminalSize.test.ts` _(new)_ | Verify the hook attaches/detaches the resize listener and updates state when stdout emits `"resize"`.                                                                                                |

## Data flow on resize

1. User resizes terminal → kernel delivers `SIGWINCH` → Node emits `"resize"` on `process.stdout`.
2. `useTerminalSize` updates state with new columns/rows and increments `resizeKey`.
3. `TaskLoop`'s `useEffect` watching `resizeKey` writes `\x1b[2J\x1b[3J\x1b[H` to clear the screen and scrollback.
4. The root `<Box key={resizeKey}>` remounts → Ink re-emits all `Static` items (full log history) and a fresh dynamic region — sized correctly for the new terminal.

## Edge cases

- **Non-TTY / piped output (`useStdout().stdout.isTTY === false`)**: skip the resize handler entirely — `process.stdout.columns` is undefined and there is no resize signal anyway.
- **Resize storms** (rapid drag): the `useTerminalSize` setter de-dupes when columns/rows haven't changed, so we don't bump the key for no-op events.
- **Very narrow terminals (< 8 cols)**: separator clamps to a minimum of 8 dashes so we don't render an empty string.
- **Initial render**: hook seeds state from `process.stdout.columns / rows` (falling back to 80×24) — no extra render compared to today.
- **Listener leak**: `useEffect` cleanup removes the `"resize"` listener on unmount.
