# Design for RLF-124

## Scope

This change is a **manual test execution**, not a code change in this
repo. The router precedence behavior under test is already implemented
in `apps/agent/src/runtime/router.ts`; the goal here is to verify it
end-to-end against a live GitHub PR using the
[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test)
fixture repo.

## What we are verifying

Router precedence when, in a single poll, the agent observes both:

1. `mention=revise` — a reviewer comment of the form
   `@ralphy revise this` on the PR opened by a change that is parked
   in `awaiting-confirmation`.
2. `prStatus=conflicting` — the PR's base branch has moved such that
   the PR no longer merges cleanly.

Expected: the `awaiting → revise via mention` row of the precedence
table wins, the confirmation flow opens for the reviewer's revise
comment, and the conflict signal is deferred until after the
resulting confirmation cycle approves. Regression signature to watch
for: conflict-fix flow runs, mention comment dropped silently.

## Files / artifacts

In this repo (ralphy):

- `openspec/changes/rlf-124-manual-test-s4-5-two-signals-same-poll/`
  — proposal, design, spec delta, tasks (this change).

In the fixture repo (`~/Developer/ralphy-rlf87-test/`):

- `WORKFLOW.confirm.md` + `WORKFLOW.mention.md` — variant under test
  (`confirm + mention`).
- `test-results/RLF-124.md` — results file with setup steps actually
  taken, observed behavior, pass/fail vs. Expected, relevant logs,
  and regression-signature notes. Authored as part of the execution
  PR.

## Execution flow

1. From `~/Developer/ralphy-rlf87-test/`, follow `CLAUDE.md`,
   `TEST_MATRIX.md`, and `README.md` to bring up the agent against
   the fixture repo using the `confirm + mention` workflow variant
   and claude haiku.
2. Drive a change into `awaiting-confirmation` so the plan-ready
   comment is posted on the PR.
3. **In the same poll window**, both:
   - push a commit to the PR's base branch that makes the PR
     conflicting, and
   - leave an `@ralphy revise this` comment on the PR as the
     reviewer.
4. Let the next poll fire. Observe which flow the agent picks.
5. Capture logs (agent runtime, router decision, indicator
   applications) and Linear/GitHub state into
   `test-results/RLF-124.md`.
6. Open a PR in `ralphy-rlf87-test` with the results file.

## Edge cases / gotchas

- Race window: both signals must land **before** the next poll. If
  the mention comment arrives in a later poll than the conflict
  signal, the conflict-fix flow will have already won legitimately —
  that configuration does not exercise S4.5 and the test must be
  re-run.
- Use claude haiku (per the issue) so the cost of the confirmation
  cycle is bounded.
- Don't patch product bugs found during this run inside this change —
  file them under
  [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87).
