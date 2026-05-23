# Design for RLF-142

## Overview

Add a world and story overview to the starter pack intro, displayed in the empty state of the TaskListView.

## Files to Touch

### New Files

- `packages/content/src/intro.ts` — exports `getStarterPackIntro()` returning structured intro content (title, world, story sections)
- `apps/ui/src/components/StarterPackIntro.tsx` — React component that renders the intro tour
- `apps/ui/src/hooks/useIntro.ts` — React hook that fetches intro content from `GET /intro`

### Modified Files

- `apps/ui/src-sidecar/server.ts` — add route handling for `GET /intro`
- `apps/ui/src-sidecar/routes/intro.ts` (new) — route handler that returns intro content
- `apps/ui/src/views/TaskListView.tsx` — replace the bare empty state with `<StarterPackIntro />`
- `packages/content/package.json` — export `intro` from the package (if needed)

## Data Flow

```
User opens Ralphy (no tasks)
  → TaskListView renders empty state
  → <StarterPackIntro /> mounts
  → useIntro() fetches GET /intro from sidecar
  → sidecar calls getStarterPackIntro() from @ralphy/content
  → returns { title, world, story }
  → StarterPackIntro renders sections
  → User clicks "Create your first task" → navigates to /tasks/new
```

## Content Design

The intro text lives in `packages/content/src/intro.ts` as a pure TypeScript object (no LLM call at runtime — the text is authored and versioned). This keeps startup fast and avoids API calls in onboarding.

```typescript
export interface StarterPackIntroContent {
  title: string;
  world: string;   // paragraph describing what Ralphy is
  story: string;   // paragraph describing the loop workflow narrative
}

export function getStarterPackIntro(): StarterPackIntroContent { ... }
```

## Edge Cases

- If the sidecar `/intro` request fails, `StarterPackIntro` falls back to hardcoded minimal text so onboarding is never broken
- The intro is only shown when `tasks.length === 0` and `!loading` — it does not flash during initial load
- No localStorage "has seen intro" flag — the intro is always shown in the empty state (serves as a persistent reference for the workflow)

## Tests

- Unit test for `getStarterPackIntro()` in `packages/content/src/__tests__/intro.test.ts` — verifies all required fields are non-empty strings
- Integration test for `GET /intro` in the sidecar — verifies the response shape
