# Design for RLF-71

## Problem

`renderTasksBlock` (apps/agent/src/agent/linear-sync/index.ts) builds the body of the sticky "📝 Tasks" Linear comment by iterating every `##` section parsed from `tasks.md`. The scaffold (apps/agent/src/agent/scaffold.ts) seeds every change with a `## Planning` section containing agent-bookkeeping items ("Read the Linear issue…", "Append an `## Implementation` section…"). Those items are useful internally so the loop knows when to transition from planning to implementation (see `planningComplete` in comment-sync.ts), but they pollute the Linear comment with content humans don't care about.

## Approach

Filter sections at render time in `renderTasksBlock` rather than mutating `tasks.md`: keeping the Planning bullets in the source file is required for the loop's planning gate and for `planningComplete`. The cheapest, most contained change is to drop sections whose heading equals "planning" (case-insensitive, trimmed) just before rendering.

## Files touched

- `apps/agent/src/agent/linear-sync/index.ts` — filter `Planning` section out of `renderTasksBlock`; emit a short placeholder when nothing remains.
- `apps/agent/src/__tests__/linear-tasks-sync.test.ts` — add tests for the filter + placeholder; update the existing multi-section test that asserts `**Planning**` appears.

## Data flow

1. `linear-sync/index.ts::renderTasksBlock(md, meta)` parses sections.
2. New step: filter out sections where `heading.trim().toLowerCase() === "planning"`.
3. If the resulting section list is empty, emit a one-line placeholder body between the markers.
4. Otherwise render as today.

`planningComplete` in comment-sync.ts still reads the unfiltered `tasks.md` from disk, so the planning gate is unaffected.

## Edge cases

- Empty tasks.md or missing Planning section → behaves as today, just without the unconditional inclusion.
- Only Planning exists (first iteration before agent appends Implementation) → placeholder text rendered instead of an empty block.
- Bullets in Planning that contain code fences are dropped along with the section (acceptable — they were agent noise anyway).
- Heading casing variants ("planning", "Planning", "PLANNING") all match via `toLowerCase()`.

## Non-goals

- Changing what gets persisted to disk in `tasks.md`.
- Changing the plan / steering comments — they already work off proposal.md, not tasks.md.
