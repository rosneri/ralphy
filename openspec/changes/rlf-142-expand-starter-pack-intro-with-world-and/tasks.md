# Tasks for RLF-142

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-142/expand-starter-pack-intro-with-world-and-story-overview and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Create `packages/content/src/intro.ts` exporting `getStarterPackIntro()` with world and story overview text
- [ ] Create `packages/content/src/__tests__/intro.test.ts` verifying `getStarterPackIntro()` returns non-empty title, world, and story fields
- [ ] Create `apps/ui/src-sidecar/routes/intro.ts` with `introRoutes()` handler for `GET /intro`
- [ ] Register `GET /intro` route in `apps/ui/src-sidecar/server.ts`
- [ ] Create `apps/ui/src/hooks/useIntro.ts` hook that fetches `GET /intro` from the sidecar
- [ ] Create `apps/ui/src/components/StarterPackIntro.tsx` component that renders the world and story overview using `useIntro()`
- [ ] Modify `apps/ui/src/views/TaskListView.tsx` to render `<StarterPackIntro />` in the empty state instead of the bare "No tasks yet" message
- [ ] Run `bun run lint` and fix any issues
- [ ] Run `bun run test` and fix any failures
