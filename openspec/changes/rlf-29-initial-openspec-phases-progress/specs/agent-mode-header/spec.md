# agent-mode-header — phase pipeline before implementation

## ADDED Requirements

### Requirement: agent header MUST render an OpenSpec phase pipeline before implementation begins

The agent-mode header MUST render an OpenSpec phase pipeline in place of
the numeric task progress bar while a change is still being bootstrapped.

While a change has not yet entered the `implement` phase (i.e.
`deriveOpenSpecPhase` returns `proposal`, `design`, `tasks`, or `done`),
the agent-mode header MUST render a horizontal phase pipeline showing the
ordered stages `proposal → design → tasks → implement` in place of the
numeric task progress bar. Each segment MUST visually distinguish three
states:

- previous stages: rendered as completed (green, `✓` glyph),
- the current stage: rendered as highlighted (bold, the phase-specific
  color from `openspecPhaseColor`, `●` glyph),
- later stages: rendered as pending (dim, `○` glyph).

Once the change enters the `implement` phase (`tasks.md` contains at least
one `- [ ]` item below an `## Implementation`-style section), the header
MUST revert to the existing numeric task progress bar driven by
`countProgress(tasksText)`.

#### Scenario: design phase shows pipeline with proposal done, design current, tasks/implement pending

- **Given** `proposal.md` is filled in but `design.md` is still a stub
- **And** `tasks.md` exists with the four bootstrap planning items unchecked
- **When** the agent-mode header renders the worker
- **Then** the header shows a pipeline segment list `[proposal:done, design:current, tasks:pending, implement:pending]`
- **And** no numeric `X/Y` progress bar is rendered for that worker

#### Scenario: implement phase restores the numeric task progress bar

- **Given** `proposal.md`, `design.md`, and an `## Implementation` section of `tasks.md` are all filled in
- **And** `tasks.md` has 2 of 7 items checked
- **When** the agent-mode header renders the worker
- **Then** the header shows the numeric progress bar with `2/7`
- **And** the phase pipeline is not rendered in the progress slot

#### Scenario: done phase shows the pipeline with all stages complete

- **Given** `tasks.md` has every item checked
- **When** the agent-mode header renders the worker
- **Then** the pipeline shows `[proposal:done, design:done, tasks:done, implement:done]`
