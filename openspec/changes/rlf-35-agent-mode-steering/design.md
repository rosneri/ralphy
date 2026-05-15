# Design for RLF-35

## Files touched

- `apps/agent/src/components/SteeringField.tsx` (NEW)
  - Self-contained single-line input. Owns buffer / cursor / focus / status
    via `useReducer`. Captures keys with Ink's `useInput`, gated by an
    `active` prop. Mirrors state changes to the parent via `onStateChange`
    so it can be reseeded after a resize-driven remount.
  - `Ctrl+S` toggles focus (works regardless of focus). When focused: `Esc`
    clears + blurs, `Enter` submits trimmed buffer (no-op on empty),
    Backspace/Delete shrink, arrows move cursor, printable input (control
    chars stripped via `/[\x00-\x1f\x7f]/g`) appends at cursor.
  - On submit, optimistically clears + blurs, then awaits `onSubmit`. Success
    flashes `sent` (green `steered → next iteration`); rejection flashes
    `failed` (red `send failed`). The 2s status timer is cleared on unmount.
  - Renders a labelled box: top border `╭── STEER (CTRL+S) ──╮` (custom string
    so the label sits inside the border), bottom border via Ink `borderTop:
false`, paddingX 1, border yellow when focused else gray.

- `apps/agent/src/agent/steering.ts` (NEW)
  - Exports `appendSteering(changeDir, message)` that wraps
    `appendSteeringMessage` from `@ralphy/core/loop` in `runWithContext(
createDefaultContext(), …)`. Mirrors the sidecar `/steer` route so the
    underlying storage helpers see an AsyncLocalStorage scope.

- `apps/agent/src/components/AgentMode.tsx`
  - Add optional test-injection props (`appendSteering`, `buildCoordinator`,
    `ensureConfig`, `loadConfig`) defaulting to the real implementations, so
    integration tests can intercept the side effect without monkey-patching
    modules.
  - Introduce three refs (`steeringBufferRef`, `steeringCursorRef`,
    `steeringFocusedInitRef`) plus `steeringFocusedRef` so the field's
    state survives the `resizeKey`-driven remount of the keyed `Box`. Pass
    the values via `initial*` props and mirror updates back via
    `onStateChange` / `onFocusChange`.
  - Gate the worker-navigation `useInput` block on
    `!steeringFocusedRef.current` so digits, `Tab`, arrows and `Ctrl+T`
    do nothing while the field is focused (the keystrokes reach
    `SteeringField` instead).
  - Render `<SteeringField>` inside the focused worker card, after the
    subtasks panel, with `width = termWidth - 2`. `onSubmit` calls
    `appendSteering(join(tasksDir, w.changeName), message)`; on error it
    pushes a red log line.
  - Account for the field's three rows in `FIXED_OVERHEAD` so
    `focusedTailLines` shrinks accordingly when the field is rendered.

## Tests added

- `apps/agent/src/components/__tests__/SteeringField.test.tsx`
  - Renders inactive → null.
  - Renders active → shows placeholder + label.
  - Ctrl+S → focus on (yellow border), buffer + cursor rendered.
  - Printable chars → captured into buffer.
  - Backspace → removes last char.
  - Esc → blurs + clears buffer.
  - Enter on empty → no submit.
  - Enter on non-empty → calls onSubmit with trimmed value, clears + blurs,
    flashes `steered → next iteration`.
  - Enter on rejecting onSubmit → flashes `send failed`.

- `apps/agent/src/__tests__/agent-mode-steering.test.tsx`
  - Field is present in the focused card.
  - Field is absent when zero workers are active.
  - End-to-end: render AgentMode with a fake coordinator (one running
    worker), press Ctrl+S, type `hello`, press Enter → injected
    `appendSteering` is called with `(tasksDir/<changeName>, "hello")`.

## Edge cases

- Empty / whitespace-only buffer + Enter: ignored. The field stays focused.
- Submit while another in-flight submit is still pending: each `onSubmit`
  call is independent; the latest `flashStatus` wins (timer cleared on the
  next status flip and on unmount).
- Terminal resize while typing: the parent `Box` is keyed on `resizeKey` so
  it remounts. The `initialBuffer` / `initialCursor` / `initialFocused`
  props seed the reducer from the parent's refs, so the buffer survives.
- Zero active workers: `steeringActive` is false → the field is unmounted
  and Ctrl+S is a no-op (the field's `useInput` is not registered).
- Non-printable input (e.g. function keys): stripped via the
  `/[\x00-\x1f\x7f]/g` regex so they don't pollute the buffer.
- Modifier-only keypresses (`Ctrl+anything except S`, `Meta+*`, plain
  `Tab`/`Up`/`Down`): swallowed (returned early) so they don't insert
  garbage; `Ctrl+S` itself is the toggle.

## Layout (focused card with field)

```
╭─ TITLE  [BADGE]  PHASE │ 3m12s │ ↺ 4 ───────────────╮
│ ▶ TASK [phase: ...] first pending task              │
│ ⏵ CMD bun run lint                                  │
│ ─ OUTPUT ─────────────────                          │
│ │ log line 1                                        │
│ ─ SUBTASKS (5) CTRL+T to close ────────             │
│ · [x] done task 1                                   │
│ · [ ] pending task                                  │
│ ╭── STEER (CTRL+S) ──╮                              │
│ │ CTRL+S to steer    │                              │
│ ╰────────────────────╯                              │
╰─────────────────────────────────────────────────────╯
```
