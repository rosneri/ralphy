# Tasks for RLF-124

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-124/manual-test-s45-two-signals-same-poll-mention-conflict and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Bring up the ralphy agent against `~/Developer/ralphy-rlf87-test/` using the `confirm + mention` variant (`WORKFLOW.confirm.md` + `WORKFLOW.mention.md`) and claude haiku per `CLAUDE.md` / `README.md` / `TEST_MATRIX.md` in that repo.
- [ ] Drive a change into `awaiting-confirmation` so the plan-ready comment is posted on its PR; capture the PR URL and the Linear issue ID into scratch notes.
- [ ] In the same poll window, push a conflicting commit to the PR's base branch **and** post `@ralphy revise this` as a reviewer comment on the PR. Record exact timestamps of both actions and the next poll tick.
- [ ] Observe the next poll: confirm Row 1 (awaiting → revise via mention) wins, the confirmation flow opens, and the conflict signal is deferred until after approval. Note the regression signature explicitly (PASS = mention wins; FAIL = conflict-fix wins and mention is dropped silently).
- [ ] Collect logs: agent runtime stdout/stderr around the deciding poll, router decision line(s), indicator applications on the Linear issue, and the PR's GitHub status (mergeable / comments).
- [ ] Author `test-results/RLF-124.md` in `~/Developer/ralphy-rlf87-test/` with: setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant log excerpts, and regression-signature notes.
- [ ] If a product bug is discovered during the run, file it under [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) (do not patch it inside this change).
- [ ] Open a PR in `ralphy-rlf87-test` containing only `test-results/RLF-124.md`; link the PR URL in the steering notes of `proposal.md`.
- [ ] Run `bunx openspec validate rlf-124-manual-test-s4-5-two-signals-same-poll` and ensure it passes.
- [ ] Run `bun run lint` and `bun run test` from the repo root to confirm no incidental regressions from edits to the openspec change directory.
- [ ] Commit all openspec changes (stage files individually, no `git add -A`), push the branch, and open the PR with title `rlf-124-manual-test-s4-5-two-signals-same-poll`.
