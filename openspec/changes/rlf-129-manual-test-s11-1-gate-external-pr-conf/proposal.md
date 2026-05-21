# RLF-129: [manual-test-S11.1] Gate + external PR + conflict + CI red (4-way collision)

Source: [RLF-129](https://linear.app/neriros/issue/RLF-129/manual-test-s111-gate-external-pr-conflict-ci-red-4-way-collision)
Status: Todo
Labels: manual-test-rlf87-automerge, manual-test-rlf87-confirm

## Why

This is the hardest probe of the post-RLF-95 router. When four hostile
signals fire in the same poll for the same ticket — confirmation gate
active, an externally-opened PR, `ralph:conflict` label, and red CI —
the router must still honour the precedence table from
`apps/agent/src/runtime/router.ts`. The RLF-87 bug class is exactly
this: `implement` or `ci-fix` fires through the gate because a
lower-precedence row sneaks past row 2 (`awaiting → confirm`).

The router's row order already encodes the intended behaviour, but no
regression test pins the 4-way collision specifically. Without that
pin, a future refactor could reorder rows or weaken a `when` predicate
and pass every existing row-level test while reintroducing RLF-87.

## What Changes

- Add a regression test in
  `apps/agent/src/runtime/__tests__/router.test.ts` that constructs a
  single `RouterSignals` with all four hostile signals set
  simultaneously (`awaiting === "awaiting"`,
  `prStatus === "ci-failing"`, `bucket === "conflicted"`) and asserts
  `route(signals).flowId === "confirmation"` with reason
  `"awaiting → confirm"`.
- Add a follow-up assertion that, once the gate clears
  (`awaiting === "none"` while conflict + CI red remain), the router
  falls through to `"conflict-fix"` before `"ci-fix"` — locking in
  row 3 → row 4 ordering.
- Add a spec delta under `specs/agent-runtime-router/spec.md`
  documenting the 4-way collision scenario as a permanent requirement
  of the precedence table.

## Acceptance criteria

- `bun run test apps/agent/src/runtime/__tests__/router.test.ts`
  passes, including the new 4-way collision case.
- `bun run lint` is clean.
- `bunx openspec validate rlf-129-manual-test-s11-1-gate-external-pr-conf`
  passes.

## Additional instructions

You are working on RLF-129: [manual-test-S11.1] Gate + external PR + conflict + CI red (4-way collision).

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
