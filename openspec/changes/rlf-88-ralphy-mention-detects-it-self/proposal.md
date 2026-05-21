# RLF-88: Ralphy mention detects it self

Source: [RLF-88](https://linear.app/neriros/issue/RLF-88/ralphy-mention-detects-it-self)
Status: Todo
Assignee: Neriya Rosner

## Why

The mention scanner currently treats Ralphy's own `📋 Ralphy plan ready …`
comment as a user `@ralphy` mention. That comment's body contains the
illustrative example `` `@ralphy revise: <reason>` `` (in a code span)
and the leading `📋` emoji is not part of the `isRalphComment` filter
regex (which only covers `🤖|🔄|✅|✗|⚠|🔁`). The result: every confirmation
poll re-queues a "mention" against the same issue, triggering a revise
loop on Ralphy's own comment, churning iterations and wasting API quota.

The mention should only fire on real `@ralphy` invocations left by a
human — not on Ralphy's own comments, and not on incidental references
inside code spans/fences (where we render the literal `@ralphy revise:`
example).

## What Changes

- Extend `isRalphComment` in `apps/agent/src/agent/wire/task-bodies.ts`
  to recognise the `📋` emoji prefix used by the "plan ready" comment,
  so the mention scanner skips it.
- Strip fenced code blocks and inline code spans from a comment body
  before applying `containsHandle`, mirroring `stripCodeMarkup` in
  `apps/agent/src/features/confirmation/inspect.ts`. This makes the
  handle match insensitive to documentation/example `@ralphy`
  references rendered in backticks.
- Add unit coverage in
  `apps/agent/src/agent/wire/__tests__/task-bodies.test.ts` for both
  filters.

## Acceptance Criteria

- `isRalphComment` returns `true` for a body starting with `📋 Ralphy …`.
- `containsHandle("reply with `@ralphy revise: x`", "@ralphy")` returns
  `false` (code span stripped).
- `containsHandle("hey @ralphy please look", "@ralphy")` still returns
  `true`.
- `bun run lint` and `bun run test` pass.

## Linear comments

**Neriya Rosner** — 2026-05-20T18:38:51.657Z
✗ Ralph exited with code 143 on this issue. Change: `rlf-88-ralphy-mention-detects-it-self`

This issue has been quarantined and will not be auto-resumed on the next poll. Inspect the worktree at `~/.ralph/<project>/worktrees/rlf-88-ralphy-mention-detects-it-self`, fix the underlying failure, then remove the error marker on this Linear issue (or run `ralph clean --name rlf-88-ralphy-mention-detects-it-self`) to clear the quarantine.
**Neriya Rosner** — 2026-05-20T18:22:00.461Z
🔁 Ralphy: revise request acknowledged — restarting at design (round 1/3).
**Neriya Rosner** — 2026-05-20T18:21:59.950Z
📋 Ralphy plan ready for `rlf-88-ralphy-mention-detects-it-self` — review proposal.md / design.md / tasks.md and approve to continue, or reply with `@ralphy revise: <reason>` to send it back to design.
**Neriya Rosner** — 2026-05-20T18:18:03.596Z

<!-- ralphy:tasks:start -->

### Ralph progress

_No mission tasks yet — planning in progress._

<sub>`rlf-88-ralphy-mention-detects-it-self` · iteration 0</sub>

<!-- ralphy:tasks:end -->

**Neriya Rosner** — 2026-05-20T18:18:03.371Z
🤖 Ralph started working on this issue. Tracking change: `rlf-88-ralphy-mention-detects-it-self`

## Additional instructions

You are working on RLF-88: Ralphy mention detects it self.

![](https://uploads.linear.app/4b55817d-edfb-449e-806f-b872c9adf4bc/76ac7c57-9289-45a4-82a7-2502489ef139/8b18f155-1b7c-4bdf-95ea-f09391b025a4)

The mention should only work in having @ before it

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
