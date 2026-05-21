# RLF-124: [manual-test-S4.5] Two signals same poll: mention + conflict

Source: [RLF-124](https://linear.app/neriros/issue/RLF-124/manual-test-s45-two-signals-same-poll-mention-conflict)
Status: Todo
Labels: manual-test-rlf87-mention, manual-test-rlf87-confirm

## Why

Scenario S4.5 of the RLF-87 manual test matrix exercises the router
precedence table when two distinct signals — `mention=revise` and
`prStatus=conflicting` — both arrive in the same poll for a change
that is parked in `awaiting-confirmation`. The router precedence table
is the single source of truth for which signal wins; if the table or
the gather/classify step regresses, a reviewer's `@ralphy revise
this` comment can be dropped silently while the conflict-fix flow
takes over. Because the failure mode is "mention silently dropped",
it cannot be caught by reading logs after the fact — it has to be
verified end-to-end against a live PR.

This change is the planning + execution record for that manual test:
the openspec delta pins the expected router precedence behavior, and
the implementation tasks drive the actual run in the
[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test)
fixture repo and the upload of the results file.

## What Changes

- Add an `agent-runtime-router` spec delta describing the expected
  precedence between `mention=revise` and `prStatus=conflicting` when
  both signals are observed in the same poll for a change in
  `awaiting-confirmation`: the mention-revise row MUST win and the
  conflict signal MUST be deferred until after the resulting
  confirmation flow approves.
- Execute the manual test from `~/Developer/ralphy-rlf87-test/` using
  the `confirm + mention` variant (`WORKFLOW.confirm.md` +
  `WORKFLOW.mention.md`, claude haiku).
- Open a PR in `ralphy-rlf87-test` containing
  `test-results/RLF-124.md` with setup steps actually taken, observed
  behavior, pass/fail vs. Expected, relevant logs, and any
  regression-signature notes.
- If a product bug is discovered, file it under
  [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87)
  rather than patching it in this change.

## Acceptance criteria

- Row 1 (awaiting → revise via mention) wins; the confirmation flow
  opens for the reviewer's `@ralphy revise this` comment.
- The conflict signal is deferred until after the confirmation flow
  approves — it MUST NOT pre-empt the mention.
- Regression signature ("conflict-fix wins; mention dropped silently")
  is explicitly checked and reported in the results file.
- `bunx openspec validate rlf-124-manual-test-s4-5-two-signals-same-poll`
  passes.
- A PR is opened against `ralphy-rlf87-test` with the results file.

## Steering

_Add steering notes here as the loop runs._
