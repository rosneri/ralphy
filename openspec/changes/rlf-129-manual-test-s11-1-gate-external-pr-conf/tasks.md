# Tasks for RLF-129

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-129/manual-test-s111-gate-external-pr-conflict-ci-red-4-way-collision and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [x]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add a regression test in `apps/agent/src/runtime/__tests__/router.test.ts` named `"4-way collision: gate wins over conflict + ci-failing + external PR"` asserting `route({ awaiting: "awaiting", bucket: "conflicted", prStatus: "ci-failing" }).flowId === "confirmation"` and `.reason === "awaiting → confirm"`.
- [x] Add a regression test in the same file named `"after gate clears, conflict-fix beats ci-fix"` asserting `route({ awaiting: "none", bucket: "conflicted", prStatus: "ci-failing" }).flowId === "conflict-fix"`.
- [x] Run `bun run test apps/agent/src/runtime/__tests__/router.test.ts` and confirm the two new cases pass alongside existing ones.
- [x] Run `bun run lint` and resolve any new findings.
- [x] Run `bunx openspec validate rlf-129-manual-test-s11-1-gate-external-pr-conf` and confirm it passes.
