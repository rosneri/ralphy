# Tasks for RLF-111

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-111/integration-tests-indicators-cli-flag-interactions-s71-s79-s81-s810 and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Add cross-flag validation in `apps/agent/src/cli.ts`: after the arg loop in `parseAgentArgs`, throw if `result.fixCi && !result.createPr` or `result.stackPrs && !result.createPr`
- [x] Write `apps/agent/src/__tests__/indicators-s7.test.ts` with tests for S7.1 (label-only filter returns false for status-only issue), S7.2 (OR semantics — partial match is sufficient), S7.3 (issue appears in both fetchTodo and fetchInProgress when it matches both indicators), and S7.6 (mergeIndicators CLI replaces config key entirely)
- [x] Write `apps/agent/src/__tests__/cli-flags-s8.test.ts` with tests for S8.1 (`--worktree` alone accepted), S8.2 (`--fix-ci` without `--create-pr` rejected; `--stack-prs` without `--create-pr` rejected), S8.6 (coordinator spawns at most 1 worker when maxTickets=1 and concurrency=2), S8.9 (`--codex` + `--worktree` both parsed correctly), and S8.10 (coordinator does not re-enqueue issue after maxConsecutiveFailures=1 consecutive failure)
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and confirm all tests pass
