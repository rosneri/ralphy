# RLF-29: Initial openspec phases progress

Source: [RLF-29](https://linear.app/neriros/issue/RLF-29/initial-openspec-phases-progress)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Problem

While a change is still being bootstrapped — `proposal.md`, `design.md`, and the
`## Implementation` section of `tasks.md` have not all been written yet — the
agent-mode header renders a progress bar driven by the count of `- [ ]` items
in `tasks.md`. Early on this is always the same fixed list of 4 generic
"Planning" tasks (read issue, refine proposal, fill design, append
implementation), so the bar shows `0/4`, then `1/4`, etc. That count is
meaningless to the operator: it tells them nothing about _which_ lifecycle
phase the loop is in (still drafting the proposal? in design? ready to
implement?), even though the loop already knows that information via
`deriveOpenSpecPhase`.

## Approach

While the change has no real implementation tasks yet (the `## Implementation`
section is missing or empty), replace the numeric task progress bar with a
horizontal **phase pipeline** showing the OpenSpec lifecycle stages
`proposal → design → tasks → implement`, where:

- previous phases render as completed (green, `✓` glyph),
- the current phase renders highlighted (bold, phase-specific color, `●`
  glyph),
- future phases render dimmed (grey, `○` glyph).

Once the change enters the `implement` phase (an `## Implementation` section
with `- [ ]` items exists in `tasks.md`), the UI reverts to the existing
numeric task progress bar — i.e. the pipeline is a _bootstrap-only_ affordance
that disappears as soon as the loop starts actually executing mission tasks.

The decision is purely a render choice in `AgentMode.tsx` driven by data that
is already collected (`openspecPhase`, `tasksText`). No new state, no new
core APIs.

## Acceptance criteria

- When `openspecPhase` is `proposal`, `design`, or `tasks` (i.e. before the
  implementation section is populated), the agent header shows a phase
  pipeline like `proposal ● ─ design ○ ─ tasks ○ ─ implement ○` (with the
  current phase highlighted, previous phases checked off, future phases
  dimmed) instead of the numeric `X/Y` progress bar.
- When `openspecPhase` is `implement`, the numeric task progress bar is
  shown as today, driven by `countProgress(tasksText)`.
- When `openspecPhase` is `done`, the pipeline shows all four stages as
  complete (no regression from current behavior, which already renders the
  full bar).
- Phase pipeline rendering is covered by a unit test that exercises
  proposal / design / tasks / implement / done states and verifies the
  computed segment list (labels, statuses, colors).
- `bun run lint` and `bun run test` pass; coverage threshold is not lowered.

## Out of scope

- Changing the underlying `OpenSpecPhase` model or `deriveOpenSpecPhase`
  logic.
- Restyling the existing `[phase: …]` chip next to `▶ TASK` (it stays).
- Renaming phases (the Linear issue mentions "research/plan" colloquially;
  we keep the canonical OpenSpec phase names: `proposal`, `design`, `tasks`,
  `implement`).

## Steering

_Add steering notes here as the loop runs._
