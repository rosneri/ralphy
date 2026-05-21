# Tasks for RLF-106

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-106/extended-test-matrix-for-rlf-87-89-scenarios and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Verify `docs/test-matrix-rlf-87.md` exists and lists every owning child ticket (RLF-108, RLF-109, RLF-110, RLF-111, RLF-112, RLF-113, RLF-114; RLF-119 through RLF-136) with their S-numbers
- [x] Verify the tracker doc explicitly links to RLF-106 as the source of truth and to RLF-108's `apps/agent/test/harness` contract (no competing harness API introduced)
- [x] Run `bunx openspec validate rlf-106-extended-test-matrix-for-rlf-87-89-scena --strict` and confirm it passes
- [x] Run `bun run lint` and confirm it passes
- [x] Run `bun run test` and confirm it passes (no `test` script; ran `bun run test:ci` — 3 pre-existing UI test failures in `SteeringField.test.tsx` and `log:test` unrelated to this docs-only change)
