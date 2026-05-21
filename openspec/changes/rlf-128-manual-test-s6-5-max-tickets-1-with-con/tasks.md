# Tasks for RLF-128

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-128/manual-test-s65-max-tickets-1-with-concurrency-2 and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] In `~/Developer/ralphy-rlf87-test/`, prepare two eligible Linear tickets so both surface in a single poll for variant `basic` (per `WORKFLOW.basic.md` and `TEST_MATRIX.md`).
- [ ] Launch the agent with `--max-tickets 1 --concurrency 2` and the variant-`basic` flags, capturing full stdout/stderr to a log file.
- [ ] Observe the first poll: confirm exactly one worker spawns and the second concurrency slot stays idle; record the log excerpt that proves this.
- [ ] Let the first worker complete; confirm the second ticket is NOT subsequently launched within the same process run.
- [ ] Write `test-results/RLF-128.md` in `ralphy-rlf87-test` containing: setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs, and any regression-signature notes (per RLF-128 Execution section).
- [ ] If a product bug is observed (e.g. second worker spawned, cap breached), file a fix issue under RLF-99 — do not patch in this change.
- [ ] Open a PR in `NeriRos/ralphy-rlf87-test` containing `test-results/RLF-128.md`.
- [ ] In this repo, run `bunx openspec validate rlf-128-manual-test-s6-5-max-tickets-1-with-con` and confirm it passes.
- [ ] In this repo, run `bun run lint` and confirm it passes.
- [ ] In this repo, run `bun run test` and confirm it passes (no source changes expected; this guards against accidental edits).
