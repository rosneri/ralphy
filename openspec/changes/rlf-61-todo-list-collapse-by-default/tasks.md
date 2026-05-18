# Tasks for RLF-61

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-61/todo-list-collapse-by-default and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Update `apps/ui/src/components/ProgressList.tsx` to track per-section expanded state with `useState`, defaulting every section to collapsed.
- [ ] Make each section header a clickable button/div that toggles its expanded state, with a caret/indicator and an item count (e.g. `2 / 5`) shown beside the title.
- [ ] Render section items only when the section is expanded; keep the existing empty-state placeholder.
- [ ] Add a unit/component test under `apps/ui/src/components/` (or appropriate test location) that verifies (a) sections start collapsed, (b) clicking a header expands the section, and (c) clicking again collapses it.
- [ ] Run `bun run lint` from the repo root and fix any new findings.
- [ ] Run `bun run test` from the repo root and ensure the suite (including the new test) passes.
- [ ] Run `bunx openspec validate rlf-61-todo-list-collapse-by-default` and ensure it passes.
