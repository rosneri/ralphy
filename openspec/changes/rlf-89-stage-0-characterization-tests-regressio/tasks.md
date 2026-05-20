# Tasks for RLF-89

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-89/stage-0-characterization-tests-regression-net and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Scaffold `apps/agent/src/__tests__/agent-characterization.test.ts` with the fake-harness imports reused from `agent-integration.test.ts` and a single placeholder `test(...)` so `bun --cwd apps/agent test agent-characterization` discovers and runs the file
- [x] Confirm Bun version in repo supports `test.failing`; if not, document the `expect(...).toThrow()` fallback in the test file header comment
- [ ] Implement scenario 1: `new ticket → approval → implement → done` (green) — assert spawn modes, label/state mutations, and tasks.md transitions across the polls
- [ ] Implement scenario 2: `new ticket → revise → design → approval → implement` (green) — assert the revise loop re-enters design and re-gates before implement
- [ ] Implement scenario 3: `gated ticket + PR conflicted → conflict-fix wins` as `test.failing(...)` — body contains the Stage-2-correct assertion (conflict-fix spawn mode wins)
- [ ] Implement scenario 4: `gated ticket + CI failing → ci-fix wins` as `test.failing(...)` — body contains the Stage-2-correct assertion (ci-fix spawn mode wins)
- [ ] Implement scenario 5: `approval persisted + tasks reset for conflict-fix → no re-gate` as `test.failing(...)` — body asserts approval label/state are preserved across the conflict-fix reset
- [ ] Implement scenario 6: `round-cap exhaustion → stuck` (green) — drive N consecutive worker failures and assert the issue is moved to `stuck`, no further spawn issued same poll
- [ ] Implement scenario 7: `finished + PR conflicting → conflict-fix` (green) — anchor for RLF-81 promotion; assert conflict promotion comment + telemetry event
- [ ] Add the JSON-output recorder for scenario 1 and capture the normalised event stream
- [ ] Write the golden file `apps/agent/src/__tests__/__golden__/json-output-new-ticket.jsonl` and add the diff assertion + `UPDATE_GOLDEN=1` re-record path
- [ ] Add the PostHog capture recorder for scenario 1 via the telemetry client fake seam
- [ ] Write the golden file `apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl` and add the diff assertion + `UPDATE_GOLDEN=1` re-record path
- [ ] Add the path normaliser helper (timestamps, tempDir, durations, pids, random ids → stable tokens) and unit-cover it inline in the test file
- [ ] Verify the diff includes no changes under `apps/agent/src/agent/**` (production code untouched) by running `git diff --stat main -- apps/agent/src/agent` and confirming an empty result
- [ ] Run `bun --cwd apps/agent test agent-characterization` and confirm all 7 scenarios pass (the 3 `.failing` ones pass by failing as expected)
- [ ] Run `bun run lint` at the repo root and fix any new lint findings introduced by the test file
- [ ] Run `bun run test` at the repo root and confirm the full suite is green and coverage does not regress
- [ ] Run `bunx openspec validate rlf-89-stage-0-characterization-tests-regressio` and confirm it passes
- [ ] Stage the new/edited files individually (`git add` per file — no `git add -A`), commit, push the branch, and open the PR with title `rlf-89-stage-0-characterization-tests-regressio`
