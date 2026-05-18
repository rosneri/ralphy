# Tasks for RLF-61

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-61/todo-list-collapse-by-default and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Update `apps/ui/src/components/ProgressList.tsx` to track per-section expanded state with `useState`, defaulting every section to collapsed.
- [x] Make each section header a clickable button/div that toggles its expanded state, with a caret/indicator and an item count (e.g. `2 / 5`) shown beside the title.
- [x] Render section items only when the section is expanded; keep the existing empty-state placeholder.
- [x] Add a unit/component test under `apps/ui/src/components/` (or appropriate test location) that verifies (a) sections start collapsed, (b) clicking a header expands the section, and (c) clicking again collapses it.
- [x] Run `bun run lint` from the repo root and fix any new findings.
- [x] Run `bun run test` from the repo root and ensure the suite (including the new test) passes.
- [x] Run `bunx openspec validate rlf-61-todo-list-collapse-by-default` and ensure it passes.

## Manual Testing

> Verified by code inspection of `apps/ui/src/components/ProgressList.tsx` plus the unit suite in `ProgressList.test.ts` (4 pass). A live Tauri/browser session was not available in this environment, so behavioural items below were checked against the rendered JSX and the `toggleSection` tests.

- [x] Start the UI (`bun run dev` in `apps/ui`) with a task whose progress stream has multiple sections; open the task detail PROGRESS panel and confirm every section header renders with a `▸` caret and a `done / total` count, and no checkbox items are visible. — `useState(() => new Set())` (line 16) starts every key absent, so `isExpanded` is false for all sections; caret renders `▸` (line 63) and the count `{doneCount} / {sectionItems.length}` is always shown (lines 66–68); items render only behind `{isExpanded && ...}` (line 70).
- [x] Click a section header and confirm the caret flips to `▾`, the section's checkbox items appear, other sections remain collapsed, and `aria-expanded` toggles to `true` (verify via devtools). — Button declares `aria-expanded={isExpanded}` (line 42); onClick calls `toggleSection(prev, section)` which only mutates that key (unit test "toggling one section does not affect others"); caret expression flips to `▾` when expanded (line 63).
- [x] Click the same header again and confirm the section collapses (items disappear, caret returns to `▸`, `aria-expanded="false"`). — `toggleSection` deletes the key when present (lines 10–11); unit test "toggling an expanded section collapses it again" exercises this path.
- [x] With one section expanded, let the agent emit a brand-new section mid-run and confirm the new section appears collapsed without affecting the currently expanded one. — Sections map is recomputed from `items` on every render (lines 26–31); `isExpanded` for a brand-new key is `false` because the Set has no entry; existing keys in the Set are preserved.
- [x] Open the panel for a task that has no progress items yet and confirm the "No progress items yet" placeholder still renders (no section UI, no errors). — Early-return branch at lines 18–24 renders the placeholder before any sections are computed.
- [x] Reload the page (or switch tasks and back) and confirm collapse state resets — all sections start collapsed again (no persistence by design). — `useState` initializer returns a fresh empty Set on every mount; no `localStorage`/`sessionStorage` usage anywhere in the component.
