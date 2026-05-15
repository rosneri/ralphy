# agent-dashboard — Steering input on focused worker card

## ADDED Requirements

### Requirement: Steering field MUST render on the focused worker card

The agent dashboard MUST render a labelled single-line steering input at the
bottom of the focused worker card whenever at least one worker is active.

The field MUST be rendered as a two-line box with a top border that embeds the
label `STEER (CTRL+S)` centred between dashes. The bottom border MUST close the
box. The border colour MUST be gray when the field is unfocused and yellow
when focused.

When the field is unfocused, the box body MUST render a single dim placeholder
line. The placeholder MUST be `CTRL+S to steer` while idle, `steered → next iteration`
(green) for ~2 seconds after a successful submit, and `send failed` (red) for
~2 seconds after a failed submit.

When the field is focused, the box body MUST render a `> ` prefix followed by
the buffer with the character at the cursor index rendered inverse.

#### Scenario: dashboard renders steering field on the focused worker

- **Given** the agent dashboard has at least one active worker
- **When** the operator views the focused worker card
- **Then** a steering field titled `STEER (CTRL+S)` is rendered at the bottom of the focused card
- **And** the placeholder reads `CTRL+S to steer`

#### Scenario: zero workers hides the steering field

- **Given** the agent dashboard has zero active workers
- **When** the operator views the dashboard
- **Then** no steering field is rendered
- **And** pressing Ctrl+S does nothing

### Requirement: Ctrl+S MUST toggle focus and suppress worker navigation while focused

Pressing `Ctrl+S` MUST toggle focus on the steering field. When the field is
focused, the worker-navigation shortcuts on the dashboard (digit keys `1`-`9`,
`Tab`, `Left`/`Right`/`Up`/`Down` arrow keys, and `Ctrl+T` for the subtasks
panel) MUST NOT switch workers or toggle the subtasks panel; those keystrokes
MUST instead be available to the steering field.

#### Scenario: Ctrl+S focuses the field and traps navigation keys

- **Given** the steering field is unfocused and the dashboard has multiple workers
- **When** the operator presses Ctrl+S, then `2`, then `Tab`
- **Then** the field becomes focused (yellow border) and the buffer contains `2` then a tab is ignored
- **And** the focused worker index is unchanged
- **And** the subtasks panel state is unchanged

#### Scenario: Ctrl+S blurs an already-focused field

- **Given** the steering field is focused with some buffered text
- **When** the operator presses Ctrl+S
- **Then** the field becomes unfocused (gray border)
- **And** worker-navigation shortcuts resume working

### Requirement: Field MUST capture characters, edit keys, Esc, and Enter

While focused, the field MUST:

- Append printable characters (after stripping control characters
  `[\x00-\x1f\x7f]`) at the cursor position.
- Remove the character before the cursor when `Backspace` or `Delete` is
  pressed (no-op when the cursor is at index 0).
- Move the cursor one position left on `Left` arrow (clamped to 0) and one
  position right on `Right` arrow (clamped to buffer length).
- Clear the buffer and blur on `Esc`.
- On `Enter`, if the trimmed buffer is non-empty, call the configured submit
  handler with the trimmed message, then optimistically clear + blur. If the
  trimmed buffer is empty, `Enter` MUST be a no-op (field stays focused with
  the whitespace buffer intact).

#### Scenario: typing, backspace, and Esc

- **Given** the field is focused with an empty buffer
- **When** the operator types `hel`, presses Backspace, types `lo`
- **Then** the buffer reads `helo`

#### Scenario: Esc clears and blurs

- **Given** the field is focused with buffer `wip`
- **When** the operator presses Esc
- **Then** the field is unfocused and the buffer is empty

#### Scenario: Enter on empty buffer is a no-op

- **Given** the field is focused with an empty buffer (or only whitespace)
- **When** the operator presses Enter
- **Then** the submit handler is NOT called
- **And** the field remains focused

### Requirement: Enter MUST append the trimmed message to the change's steering.md

When the operator submits a non-empty trimmed message, the dashboard MUST
append that message to `openspec/changes/<changeName>/steering.md` for the
focused worker's change, via `appendSteeringMessage` from `@ralphy/core/loop`,
wrapped in a default `runWithContext` scope.

On success, the field MUST clear, blur, and flash the green hint
`steered → next iteration` for ~2 seconds.

On failure, the field MUST clear, blur, flash the red hint `send failed` for
~2 seconds, and a red log line MUST be emitted to the dashboard log.

#### Scenario: submit appends to steering.md

- **Given** the focused worker's change name is `my-change` and its `tasksDir/my-change/steering.md` is empty
- **And** the field is focused with buffer `please use the cached client`
- **When** the operator presses Enter
- **Then** `appendSteeringMessage` is invoked with the trimmed message and the change directory
- **And** the field clears + blurs
- **And** the placeholder briefly reads `steered → next iteration` (green)

#### Scenario: submit failure surfaces an error hint

- **Given** the configured submit handler rejects with an error
- **When** the operator submits a non-empty message
- **Then** the placeholder briefly reads `send failed` (red)
- **And** a red log line is emitted

### Requirement: Field state MUST survive terminal resize

The steering field's buffer, cursor position, and focus state MUST survive a terminal resize.
When the parent `Box` remounts because its `resizeKey` changed, the field MUST
be reseeded from the parent's refs so the in-progress message is preserved.

#### Scenario: resize preserves in-progress steering text

- **Given** the field is focused with buffer `half-typed message`
- **When** the terminal is resized (triggering the parent's `resizeKey` to change)
- **Then** the field is still focused
- **And** the buffer still reads `half-typed message`
