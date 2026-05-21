# Tasks for RLF-88

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-88/ralphy-mention-detects-it-self and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Extend `isRalphComment` in `apps/agent/src/agent/wire/task-bodies.ts` so its emoji-prefix regex also matches `📋` (the prefix Ralphy uses for the "plan ready" gate comment).
- [ ] Add a private `stripCodeMarkup` helper in `apps/agent/src/agent/wire/task-bodies.ts` (fenced ` ``` ` and inline `` ` `` spans replaced with a space) and apply it inside `containsHandle` before running the handle regex, so `@ralphy` references inside code spans/blocks do not match.
- [ ] Add `apps/agent/src/agent/wire/__tests__/task-bodies.test.ts` with cases: (a) `isRalphComment` returns true for the literal "📋 Ralphy plan ready …" body; (b) `containsHandle` returns false for `@ralphy` inside backticks / fenced block; (c) `containsHandle` still returns true for a bare `hey @ralphy` mention; (d) the existing `🤖|🔄|✅|✗|⚠|🔁` prefixes still match.
- [ ] Run `bun run lint` and fix any issues it reports in the files touched by this change.
- [ ] Run `bun run test` and ensure the suite passes (including the new task-bodies tests).
- [ ] Run `bunx openspec validate rlf-88-ralphy-mention-detects-it-self` and confirm it succeeds.
