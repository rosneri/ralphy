# beads-task-backend-spike — evaluate `bd` behind the ChangeStore seam

## ADDED Requirements

### Requirement: A prototype BeadsChangeStore MUST reproduce markdown task selection

The spike MUST deliver a prototype `BeadsChangeStore` implementing the existing
`ChangeStore` interface whose read-path (`readTaskList`, `getStatus`,
`validateChange`) derives task state from `bd` (the beads CLI) rather than from
`tasks.md` / `agent-tasks.md`. The next-task selection it produces MUST match
what `firstUnchecked` + `pickActiveTasksFile` (`packages/core/src/tasks-md.ts`)
produce for the equivalent markdown checklist, including the invariant that a
high-priority "flow" task that `blocks` mission work is selected first.

The prototype is explicitly throwaway/evaluation scope: it MUST NOT be
registered as the default `ChangeStore` and MUST NOT modify `loop.ts`,
`tasks-md.ts`, or the flow machine.

#### Scenario: ready selection matches firstUnchecked

- **Given** a change modeled as a `bd` epic with three open task children and a
  `blocks` dependency between two of them
- **When** the prototype `BeadsChangeStore` resolves the next task via
  `bd ready --json --limit 1`
- **Then** it returns the same single task that `firstUnchecked` selects from
  the equivalent `tasks.md`
- **And** a high-priority flow bead that `blocks` a mission task is returned
  before that mission task, reproducing `agent-tasks.md` preemption.

#### Scenario: blocked-but-not-done is not reported complete

- **Given** a `bd` epic whose only open child is blocked by an open dependency
- **When** the prototype reports completion via `getStatus`
- **Then** the change is reported as NOT complete (open children remain)
- **And** an empty `bd ready` result alone is NOT treated as "all tasks
  completed".

### Requirement: The spike MUST record a go/no-go decision and operational findings

The spike MUST update `design.md` with a decision record that answers all five
open questions (adapter-vs-native, OpenSpec spec artifacts, Linear sync,
flow/preemption modeling, the `bd` binary dependency) and a go/no-go
recommendation. It MUST also document the shared-`.beads/`-across-worktrees
concurrency result with the exact commands run and output observed.

#### Scenario: two worktrees share one .beads/

- **Given** two concurrent git worktrees pointing at one main-repo `.beads/`
- **When** each runs `bd ready` and one runs `bd claim` on a task
- **Then** both worktrees observe consistent state with no double-claim and no
  JSONL corruption
- **And** the commands and observed output are recorded in `design.md`.
