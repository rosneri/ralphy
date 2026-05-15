# loop-tui — preserve UI state on terminal resize

## ADDED Requirements

### Requirement: TaskLoop MUST redraw cleanly after a terminal resize

When the terminal running `ralph task` is resized, the TUI MUST re-render so
that the status bar, log feed, and steer prompt are laid out for the new
terminal dimensions with no overlapping or misaligned content.

The redraw MUST preserve the full log history that was visible before the
resize (re-emit, not lose it), keep the running iteration / cost / elapsed-time
state intact, and leave the steer input usable.

When stdout is not a TTY (piped output), the resize handler MUST be a no-op so
non-interactive runs are not affected.

#### Scenario: widening the terminal redraws without overlap

- **Given** `ralph task` is running with several log lines and the live status bar visible
- **When** the user widens the terminal window
- **Then** the entire UI is re-emitted at the new width
- **And** no scrollback line overlaps the live status bar
- **And** the iteration count, cost, and elapsed time shown after the redraw match the values from before the resize

#### Scenario: narrowing the terminal redraws the status separator

- **Given** `ralph task` is running in an 80-column terminal
- **When** the user shrinks the terminal to 30 columns
- **Then** the status bar separator rule renders at the narrower width (clamped to a minimum of 8 dashes)
- **And** the log lines below remain readable with no torn frames

#### Scenario: piped stdout ignores resize

- **Given** `ralph task` is invoked with stdout piped to a file (non-TTY)
- **When** a `SIGWINCH` would otherwise fire
- **Then** the program does not subscribe to `"resize"` and does not emit any clear-screen escape sequence
