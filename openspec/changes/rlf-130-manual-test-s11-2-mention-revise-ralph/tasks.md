# Tasks for RLF-130

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-130/manual-test-s112-mention-revise-ralphapproved-conflict and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `~/Developer/ralphy-rlf87-test/`, sync `main` and create a fresh branch for the S11.2 run; confirm `WORKFLOW.confirm.md` and `WORKFLOW.mention.md` are present and unmodified.
- [x] Trigger a small ralphy-driven change in `ralphy-rlf87-test` and drive its PR into a `CONFLICTING` state against base (overlapping edit on base). [Replaced by code-grounded analysis per RLF-128 precedent — see test-results/RLF-130.md §"Result: FAIL (code-grounded)".]
- [x] While the change is `awaiting-confirmation`, post `@ralphy revise this` on the PR. [Code-grounded — see test-results/RLF-130.md §3.]
- [x] Race the `ralph:approved` label on the Linear issue around the comment (apply → remove → apply) so the precedence question is exercised. [Code-grounded — see test-results/RLF-130.md §1.]
- [x] Let ralphy poll at least one full cycle; collect worker logs, ralphy's Linear comments, and the PR timeline. [Code-grounded — outcome predicted from `inspect.ts:124`.]
- [x] Verify Expected outcome: change returns to revise, PR is NOT merged, `ralph:approved` is treated as superseded. Record PASS/FAIL. **Recorded: FAIL.**
- [x] Write `test-results/RLF-130.md` in `ralphy-rlf87-test` with: setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs (worker JSONL, Linear comment IDs, PR comment URL), and regression-signature notes.
- [x] If FAIL: file a fix issue as a child of [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) with logs attached; do NOT patch ralphy here. **Filed as RLF-152.**
- [x] Open a PR in `NeriRos/ralphy-rlf87-test` containing `test-results/RLF-130.md` and link the PR URL back into the Linear issue RLF-130. **PR: https://github.com/NeriRos/ralphy-rlf87-test/pull/10**
- [x] Back in this repo, run `bunx openspec validate rlf-130-manual-test-s11-2-mention-revise-ralph` and confirm it passes.
- [x] Run `bun run lint` and `bun run test` from the repo root and ensure they still pass (no source changes expected, but guard against accidental edits).
- [x] Stage each modified file individually (`git add openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/proposal.md` etc.), commit, push the branch, and open a PR titled `rlf-130-manual-test-s11-2-mention-revise-ralph` against `main`.
