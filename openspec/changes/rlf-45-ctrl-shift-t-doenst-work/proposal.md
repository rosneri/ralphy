# RLF-45: ctrl shift t doenst work

Source: [RLF-45](https://linear.app/neriros/issue/RLF-45/ctrl-shift-t-doenst-work)
Status: Todo
Assignee: Neriya Rosner

## Why

`Ctrl+Shift+T` is the AgentMode shortcut for expanding the SUBTASKS
panel over the OUTPUT feed (see `apps/agent/src/components/AgentMode.tsx`
at the `useInput` handler), but most terminals (iTerm2, Terminal.app,
VS Code's integrated terminal, GNOME Terminal, …) either swallow
`Ctrl+Shift+T` for their own "new tab" binding or do not deliver the
shift modifier alongside a plain-ASCII control character. As a result
the shortcut never fires and users cannot expand the subtask list. The
user has asked that we replace it with `Ctrl+Opt+T` (a.k.a.
`Ctrl+Alt+T`), which ink delivers reliably via `key.meta`.

## What Changes

- Rebind the "expand all subtasks" shortcut in `AgentMode` from
  `Ctrl+Shift+T` to `Ctrl+Alt+T` (`key.ctrl && key.meta`). `Ctrl+T`
  (toggle pending tasks panel) is unchanged.
- Update the in-app hint rendered next to the truncated subtask list
  (`… +N more (CTRL+SHIFT+T to expand)` → `… +N more (CTRL+ALT+T to expand)`)
  and the surrounding JSDoc comments to reference the new binding.

## Acceptance Criteria

- Pressing `Ctrl+Alt+T` (Opt on macOS) inside AgentMode toggles the
  expanded subtasks view exactly the same way `Ctrl+Shift+T` did before.
- Pressing `Ctrl+T` still toggles the pending-tasks panel and is not
  intercepted by the new binding.
- The "+N more" hint reads `(CTRL+ALT+T to expand)`.
- `bun run lint` and `bun run test` pass.

## Description

use instead ctrl opt t

## Additional instructions

You are working on RLF-45: ctrl shift t doenst work.

use instead ctrl opt t

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
