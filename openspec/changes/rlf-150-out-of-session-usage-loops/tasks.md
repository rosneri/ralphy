# Tasks for RLF-150

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-150/out-of-session-usage-loops and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `SESSION_LIMIT_PATTERNS` and `isResultErrorLimitText()` to `packages/engine/src/agents/claude.ts`; check `result-error` events against it to set `detectedRateLimit = true`
- [x] Mirror the same `SESSION_LIMIT_PATTERNS` and `isResultErrorLimitText()` detection in `packages/engine/src/agents/scripted.ts`
- [x] Add guard in `apps/loop/src/hooks/useLoop.ts` between non-zero exit block and success path: when `engineResult.rateLimited` is true on exit 0, log, record, emit, and break
- [x] Add unit tests for result-error usage-limit detection in `packages/engine/src/__tests__/agents.test.ts`
- [x] Add engine-level tests for result-error usage-limit detection via scripted agent in `packages/engine/src/__tests__/engine.test.ts`
- [x] Add structural assertion in `apps/loop/src/hooks/__tests__/useLoop.test.ts` confirming the guard is present
- [x] Run `bun run lint` and confirm 0 errors
- [x] Run `bun test` in `packages/engine` and `apps/loop` and confirm all tests pass
