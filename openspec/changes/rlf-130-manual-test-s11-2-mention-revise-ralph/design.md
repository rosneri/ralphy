# Design for RLF-130 — Manual test S11.2 (mention=revise + ralph:approved + conflict)

## Scope

This is a **manual test** mission. No ralphy source code changes are
expected. The deliverable is:

1. An executed test in the `ralphy-rlf87-test` repo against the `confirm + mention` variant.
2. A `test-results/RLF-130.md` file inside that repo summarising setup,
   observed behavior, pass/fail vs. the Expected outcome, and any
   regression-signature evidence.
3. A PR opened in `ralphy-rlf87-test` that adds that results file.
4. This openspec change (proposal, design, tasks, spec delta) recording
   the precedence rule under test.

## Test target

- Repo: [`NeriRos/ralphy-rlf87-test`](https://github.com/NeriRos/ralphy-rlf87-test) (clone at `~/Developer/ralphy-rlf87-test/`)
- Engine: claude haiku
- Workflow variant: `WORKFLOW.confirm.md` + `WORKFLOW.mention.md` (`confirm + mention`)

## Test recipe

1. From a clean state, kick off a small change in `ralphy-rlf87-test` so ralphy opens a PR that ends up **conflicting** with its base branch (e.g. land an overlapping edit on the base while the PR is open).
2. While the PR is in `awaiting-confirmation`, post a reviewer comment on the PR: `@ralphy revise this`.
3. Around that comment, toggle the `ralph:approved` label on the Linear issue: apply → remove → apply (label race). The mention should precede the final label flip so the precedence question is real.
4. Let ralphy poll. Observe whether it (a) sends the change back to design / revise (PASS — Row 1 wins) or (b) tries to merge the conflicting PR (FAIL — regression signature triggered).
5. Capture logs from the agent (worker logs, ralphy Linear comments, PR timeline) into `test-results/RLF-130.md`.

## Expected vs. regression

- **Expected (PASS):** the change returns to revise; PR is not merged; `ralph:approved` is treated as superseded.
- **Regression (FAIL):** the agent ignores the revise mention, treats `ralph:approved` as authoritative, and attempts (or completes) a merge despite the conflict. File a child of [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) with logs.

## Edge cases to note in the results file

- Whether the label race order changed the outcome (apply→remove→apply vs. remove→apply→remove).
- Whether the `@ralphy revise` mention was posted on the PR vs. on the Linear issue, and whether ralphy detected it on both surfaces.
- Whether the PR conflict caused any short-circuit before precedence was evaluated (e.g. early-exit on `mergeable=CONFLICTING`).
- Self-mention false positives — ensure the reviewer comment, not a ralphy-prefixed comment, is what produced the `MentionTrigger`.

## Files touched in this repo

- `openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/proposal.md`
- `openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/design.md`
- `openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/tasks.md`
- `openspec/changes/rlf-130-manual-test-s11-2-mention-revise-ralph/specs/manual-test-rlf-130/spec.md`

No code under `apps/` or `packages/` is modified by this change.
