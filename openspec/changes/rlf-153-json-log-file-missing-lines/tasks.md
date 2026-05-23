# Tasks for RLF-153

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-153/json-log-file-missing-lines and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `jsonLogChains: Map<string, Promise<void>>` module-level map and rewrite `logJsonEvent` to serialize writes per path in `packages/log/src/log.ts`
- [x] Add `flushJsonLog(logFile: string): Promise<void>` export in `packages/log/src/log.ts`
- [x] Reset the chain in `initWorkerLog` after truncating the file in `packages/log/src/log.ts`
- [x] Write a test in `packages/log/src/__tests__/log.test.ts` that fires many concurrent `logJsonEvent` calls and asserts all lines appear in the output file (use `flushJsonLog` to await completion)
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and confirm all tests pass
