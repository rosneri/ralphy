# Design for RLF-61

## Files to touch

- `apps/ui/src/components/ProgressList.tsx` — add per-section collapsed state and disclosure UI.

## Data flow

`ProgressList` groups its `items` prop into a `Map<sectionName, ProgressItem[]>`. We add a `useState<Record<string, boolean>>` (or `Set<string>`) tracking which sections the user has expanded. Default value is an empty set, so every section is collapsed on first render.

Each section header becomes a `<button>` (or clickable `<div>`) that toggles its key in that state. When the section is expanded, its items render as today; when collapsed, only the header (with a caret indicator and an `n` item count) renders.

## Edge cases

- Empty items: keep the existing "No progress items yet" placeholder; no sections to show.
- New sections appearing mid-run (the list is streamed): unknown sections default to collapsed because they aren't in the expanded set.
- Section names are used as keys. Two sections sharing a name would already collide in the existing `Map` grouping, so this is unchanged.
- Item count: shown next to header so users still see "[2/5]" style information without expanding.

## Non-goals

- No persistence of collapse state across reload (kept as local component state).
- No global "expand all" / "collapse all" control.
- No animation.
