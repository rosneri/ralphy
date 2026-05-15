# Design for RLF-49

## Touched files

- `apps/agent/src/components/AgentMode.tsx` — the POLL STATUS box at
  approximately lines 855–922. The second row's countdown branch
  (`secsToNextPoll !== null`) currently renders `<Box gap={1}>` with
  `↺` + `<n>s` (5 visible columns). The placeholder branch
  (`secsToNextPoll === null`) renders `" ".repeat(7)` (7 columns).

## Approach

Give the countdown `Box` an explicit `width={7}` so the segment always
occupies 7 terminal columns, matching the placeholder branch. With the
outer `Box gap={2}` already in place, the trailing `│` then lands at
the same column as the `│` after `Idle` in row 1 (spinner=1 + gap=2 +
`Idle`=4 = 7).

Edge cases:

- `secsToNextPoll` may be 1–3 digits (`9s` … `120s`). Width 7 leaves
  comfortable headroom for the largest expected countdown.
- The placeholder branch is unchanged; it already reserves the same
  7-column footprint.
- When row 1 shows `Polling Linear…` (15 cols) instead of `Idle`, the
  pipes are momentarily misaligned during the poll itself. That state
  is transient and the row-2 countdown is only shown after a poll
  completes (`pollStatus.lastAt !== null`), so in practice row 1 reads
  `Idle` whenever the countdown is visible.

## Data flow

Pure render-time change. No state, props, or types are added or
removed.
