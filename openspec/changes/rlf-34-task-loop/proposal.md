# RLF-34: Task loop

Source: [RLF-34](https://linear.app/neriros/issue/RLF-34/task-loop)
Status: In Progress
Assignee: Neriya Rosner

## Why

Two repeating problems make every task loop noisy and unreliable:

1. **Validation almost always warns about missing sections.** `bunx openspec validate <change>`
   reports `Change must have a Why section. Missing required sections. Expected headers: "## Why"
and "## What Changes". Ensure deltas are documented in specs/ using delta`. The agent scaffolds
   `proposal.md` with `## Description` / `## Steering` instead of the validator-required `## Why`
   and `## What Changes`, so the very first `openspec validate` call fails on every new change.
2. **Completion banner is printed multiple times.** When a change finishes, the terminal output
   contains the `All tasks completed — change archived.` block and the
   `See: …/tasks.md` line three times in a row. The duplicate ghost copies come from the loop
   setting `stopReason` _before_ appending the trailing info logs and committing the task dir —
   Ink keeps flushing new `<Static>` items while the bottom `<StopMessage>` is on screen, leaving
   ghost copies as the terminal scrolls.

## What Changes

- **Scaffold proposal.md with the validator-required structure.** `scaffoldChangeForIssue` will
  emit `## Why` and `## What Changes` sections (pre-filled with the Linear description /
  placeholder text), in addition to the existing `## Description`, `## Additional instructions`,
  and `## Steering` sections.
- **Update planning tasks.md** to remind the agent to refine `## Why` / `## What Changes` and to
  add at least one spec delta under `specs/` so `openspec validate` passes before commit.
- **Eliminate the triple completion banner.** In `useLoop.ts`, move `setStopReason(reason)` so it
  fires _after_ all final `addInfo` / commit / push work, immediately before `setIsRunning(false)`.
  Render `StopMessage` only when the loop is no longer running. The dynamic stop block is then
  drawn once and committed to stdout exactly once at exit.
- **Tests cover both fixes.** New scaffold test asserts the presence of `## Why` and
  `## What Changes` in the generated proposal. New `useLoop` (or component) test asserts
  `StopMessage` is not rendered while `isRunning` is still true.

## Acceptance Criteria

- A freshly scaffolded change passes the "has required sections" portion of `openspec validate`
  without manual edits.
- Running a task loop end-to-end prints the `All tasks completed — change archived.` banner and
  its `See: …` line exactly once.
- `bun run lint` and `bun run test` pass.

## Steering

_Add steering notes here as the loop runs._
