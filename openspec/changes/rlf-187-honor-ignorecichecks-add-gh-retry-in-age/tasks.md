# Tasks for RLF-187

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-187/honor-ignorecichecks-add-gh-retry-in-agent-list-pr-status and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Extend `RawCheck` in `apps/agent/src/shared/pr/ci-classify.ts` with optional `name?: string` and `context?: string` fields
- [x] Update `bucketChecks()` in `apps/agent/src/pr-status.ts` to accept `ignoreCiChecks: string[] = []` and filter checks by `name`/`context` (case-insensitive) before classifying; change empty array (`[]`) to return `"pass"` instead of `"pending"`
- [x] Add optional `ignoreCiChecks?: string[]` and `sleepFn?: (ms: number) => Promise<void>` parameters to `fetchPrStatus` in `apps/agent/src/pr-status.ts`
- [x] Replace the bare `runner.run()` call in `fetchPrStatus` with `runGhWithRetry(...)` (importing from `./shared/pr/ci-classify`), passing `sleepFn` through
- [x] Add `ignoreCiChecks: string[]` parameter to `fetchAndPrintLinear` in `apps/agent/src/list.ts` and thread it into the `fetchPrStatus` call at line 283
- [x] Pass `cfg.ignoreCiChecks` from `runList` into `fetchAndPrintLinear` at line 368 of `apps/agent/src/list.ts`
- [x] Add test: a failing check whose name matches `ignoreCiChecks` yields `ciBucket: "pass"` (`apps/agent/src/__tests__/pr-status.test.ts`)
- [x] Add test: a transient 5xx error on the first `runner.run()` call is retried, and the subsequent success yields `{ kind: "ok" }` (use a counter-based `CmdRunner` + instant `sleepFn`)
- [x] Add test: `statusCheckRollup: []` on an open PR yields `ciBucket: "pass"` (not `"pending"`)
- [x] Run `bun run lint` and fix any errors
- [x] Run `bun run test` and confirm all tests pass with no regressions
