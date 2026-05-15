# Tasks for RLF-35

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-35/agent-mode-steering and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Add `apps/agent/src/components/SteeringField.tsx` — self-contained labelled single-line input. Owns buffer/cursor/focus/status via `useReducer`. Ctrl+S toggles focus; Enter submits trimmed non-empty buffer; Esc clears+blurs; Backspace/Delete and arrow keys edit the buffer; printable input is appended at cursor (control chars stripped). Renders a top border with embedded `STEER (CTRL+S)` label and an Ink rounded bottom border. Mirrors state via `onStateChange` and seeds from `initial*` props for resize-survival.
- [x] Add `apps/agent/src/agent/steering.ts` exporting `appendSteering(changeDir, message)` that wraps `appendSteeringMessage` from `@ralphy/core/loop` in `runWithContext(createDefaultContext(), …)`, mirroring the sidecar `/steer` route.
- [x] Wire `<SteeringField>` into `apps/agent/src/components/AgentMode.tsx` at the bottom of the focused worker card. Use `width = termWidth - 2`. `onSubmit` calls `appendSteering(join(tasksDir, w.changeName), message)`; errors push a red log line.
- [x] Add optional test-injection props (`appendSteering`, `buildCoordinator`, `ensureConfig`, `loadConfig`) to `AgentMode` defaulting to the real implementations so the integration test can intercept side effects without module mocks.
- [x] Persist buffer / cursor / focus in refs (`steeringBufferRef`, `steeringCursorRef`, `steeringFocusedInitRef`, `steeringFocusedRef`) on `AgentMode` and seed `SteeringField` via `initial*` props so the `resizeKey`-driven remount of the parent `Box` does not blank the buffer.
- [x] Gate the worker-navigation `useInput` (digits, Tab, arrows, Ctrl+T) on `!steeringFocusedRef.current` so those keys flow into the steering buffer while it is focused.
- [x] Account for the field's three rows in `FIXED_OVERHEAD` (top border + body row + bottom border) so `focusedTailLines` shrinks when the field is rendered.
- [x] Add `apps/agent/src/components/__tests__/SteeringField.test.tsx` covering focus toggle, char capture, Backspace, Esc, Enter on empty buffer (no-op), and Enter on non-empty (submits trimmed value, clears, blurs).
- [x] Add `apps/agent/src/__tests__/agent-mode-steering.test.tsx` covering: field present in focused card, field absent with zero workers, and Ctrl+S → `hello` → Enter dispatching the injected `appendSteering` with the change directory + trimmed message.
- [x] Run `bun run lint` and fix any findings (0 errors)
- [x] Run `bunx nx run agent:test` and fix any failures (248 pass)
- [x] Run `bunx nx run agent:typecheck` and fix any failures (passes)
- [x] Run `bunx oxfmt apps/agent/src` to keep formatting clean
- [x] Run `bunx openspec validate rlf-35-agent-mode-steering`

## Manual Testing

- [x] **Field renders on focused worker card.** Inspect `apps/agent/src/components/AgentMode.tsx` — confirm `<SteeringField>` is rendered inside `idx === safeFocusedIdx` branch with `width = termWidth - 2` and `active = steeringActive` (= raw mode supported AND `activeCount > 0`). Confirmed at `apps/agent/src/components/AgentMode.tsx:1091`.
- [x] **Field is hidden with zero workers.** `steeringActive` is `false` when `activeCount === 0`, so the field is unmounted and Ctrl+S is a no-op. Covered by `agent-mode-steering.test.tsx` "renders no steering field when zero workers are active".
- [x] **Ctrl+S toggles focus.** Pressing Ctrl+S dispatches `toggleFocus` regardless of current focus; verified by `SteeringField.test.tsx` "Ctrl+S focuses the field" and "Ctrl+S again blurs the field".
- [x] **Border colour flips on focus.** `borderColor = focused ? "yellow" : "gray"` (`SteeringField.tsx:188`). Verified by snapshot assertions in `SteeringField.test.tsx`.
- [x] **Worker-navigation shortcuts are suppressed while focused.** `AgentMode.tsx` worker `useInput` returns early when `steeringFocusedRef.current === true`, so digits `1`-`9`, Tab, arrow keys, and Ctrl+T all flow into the buffer instead of switching workers / toggling subtasks. Confirmed by `agent-mode-steering.test.tsx` end-to-end (typing `hello` does not move focus across workers).
- [x] **Printable keys append at cursor.** `dispatch({ type: "insert", chars: printable })` inserts before/after the cursor. Covered by `SteeringField.test.tsx` "captures printable characters".
- [x] **Control characters are stripped.** Input is filtered through `/[\x00-\x1f\x7f]/g` before being inserted, so function keys and escape sequences do not pollute the buffer.
- [x] **Backspace removes the char before the cursor.** Reducer no-ops when `cursor === 0`. Covered by `SteeringField.test.tsx` "backspace deletes last character".
- [x] **Esc clears the buffer and blurs the field.** `dispatch({ type: "clearAndBlur" })` resets buffer + cursor + focus. Covered by `SteeringField.test.tsx` "Esc clears and blurs".
- [x] **Enter on empty / whitespace buffer is a no-op.** `trimmed.length === 0` short-circuits the submit; the field stays focused. Covered by `SteeringField.test.tsx` "Enter on empty does nothing".
- [x] **Enter on non-empty buffer submits trimmed value.** Calls `onSubmit(trimmed)`, then `dispatch({ type: "clearAndBlur" })`. Covered by `SteeringField.test.tsx` and `agent-mode-steering.test.tsx` "Ctrl+S, type hello, Enter calls appendSteering".
- [x] **Successful submit flashes `steered → next iteration`.** `flashStatus("sent")` runs in the resolved branch; placeholder colour switches to green; reverts to `CTRL+S to steer` after `STATUS_HINT_MS` (2000ms).
- [x] **Failed submit flashes `send failed`.** `flashStatus("failed")` runs in the rejected branch; placeholder colour switches to red; a red log line is emitted from `AgentMode.tsx`'s `onSubmit` error branch.
- [x] **`appendSteering` writes to the correct path.** `AgentMode.tsx` invokes `appendSteering(join(tasksDir, w.changeName), message)`. Under the hood, `appendSteeringMessage` writes to `<changeDir>/steering.md`. Verified by `agent-mode-steering.test.tsx` end-to-end (injected `appendSteering` receives the expected `(dir, message)` args).
- [x] **Buffer survives terminal resize.** `steeringBufferRef`, `steeringCursorRef`, `steeringFocusedInitRef` mirror the field's state; on `resizeKey`-driven parent remount, the field is re-seeded from the refs via `initial*` props. Verified by code inspection — refs live outside the keyed `Box`, so they are stable across remounts.
- [x] **`FIXED_OVERHEAD` accounts for the field's three rows.** `steeringBoxLines = steeringActive ? 3 : 0` is added to `FIXED_OVERHEAD`, so the focused tail shrinks correctly when the field is rendered.
- [x] **Top border embeds the label.** Manual top border string is `╭{─...} STEER (CTRL+S) {─...}╮` with the label centred. Bottom border uses Ink's `borderStyle="round"` with `borderTop={false}` so the box visually closes.
- [x] **Run `bunx nx run agent:test`** — 248 tests pass including the new `SteeringField.test.tsx` and `agent-mode-steering.test.tsx`.
- [x] **Run `bun run lint`** — 0 errors (warnings unrelated to this change).
- [x] **Run `bunx nx run agent:typecheck`** — passes.
- [x] **Run `bunx oxfmt --check apps/agent/src`** — all files use the correct format.
- [x] **Run `bunx openspec validate rlf-35-agent-mode-steering`** — passes.
