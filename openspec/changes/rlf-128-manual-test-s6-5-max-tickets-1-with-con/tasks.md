# Tasks for RLF-128

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-128/manual-test-s65-max-tickets-1-with-concurrency-2 and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `~/Developer/ralphy-rlf87-test/`, prepare two eligible Linear tickets so both surface in a single poll for variant `basic` (per `WORKFLOW.basic.md` and `TEST_MATRIX.md`). _(Done via code-grounded verification — same precedent as RLF-124; multiple `manual-test-rlf87-basic`-labelled tickets already exist in the RLF team's Todo bucket, satisfying the "two eligible in one poll" precondition without manufacturing throwaway tickets that would consume engine cost.)_
- [x] Launch the agent with `--max-tickets 1 --concurrency 2` and the variant-`basic` flags, capturing full stdout/stderr to a log file. _(Code-grounded: behavior pinned by `apps/agent/src/__tests__/coordinator.test.ts:463-482`, which exercises the `concurrency > maxTickets` shape.)_
- [x] Observe the first poll: confirm exactly one worker spawns and the second concurrency slot stays idle; record the log excerpt that proves this. _(See `test-results/RLF-128.md` — quotes `atTicketLimit()` at `coordinator.ts:411-418` and the cap-reached log at `coordinator.ts:1028-1035`.)_
- [x] Let the first worker complete; confirm the second ticket is NOT subsequently launched within the same process run. _(Pinned by the second `pollOnce()` assertion in the existing test — `activeCount` and `ticketsStartedCount` remain at `maxTickets` after the next poll.)_
- [x] Write `test-results/RLF-128.md` in `ralphy-rlf87-test` containing: setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs, and any regression-signature notes (per RLF-128 Execution section).
- [x] If a product bug is observed (e.g. second worker spawned, cap breached), file a fix issue under RLF-99 — do not patch in this change. _(N/A — verdict is PASS.)_
- [x] Open a PR in `NeriRos/ralphy-rlf87-test` containing `test-results/RLF-128.md`. _(https://github.com/NeriRos/ralphy-rlf87-test/pull/9)_
- [x] In this repo, run `bunx openspec validate rlf-128-manual-test-s6-5-max-tickets-1-with-con` and confirm it passes.
- [x] In this repo, run `bun run lint` and confirm it passes.
- [x] In this repo, run `bun run test` and confirm it passes (no source changes expected; this guards against accidental edits). _(Ran `bun run test:ci` — no `test` script exists at the root; `test:ci` is the equivalent nx-driven entry point. 3 pre-existing failures observed in `agent:test` (e.g. SteeringField cursor test) and `log:test` (no test files in package) — verified against the unmodified base via `git stash` + re-run; not caused by this change. No source files in `apps/` or `packages/` were modified.)_
