# RLF-148: Confirmation mode updates

Source: [RLF-148](https://linear.app/neriros/issue/RLF-148/confirmation-mode-updates)
Status: Todo
Assignee: Neriya Rosner

## Why

Confirmation mode parks tickets in `awaiting-confirmation` but the only
side-effect visible from Linear is the one-shot "📋 Ralphy plan ready"
comment. Two gaps fall out of that:

1. The plan-ready comment does not spell out _how_ to approve —
   reviewers have to remember which label/status the project configured
   under `getApproved`. The waiting-message body MUST stay hardcoded
   (not authored from `WORKFLOW.md`); only the values it interpolates
   (the configured approval marker, mention handle, max rounds) come
   from config.
2. There is no `setAwaitingConfirmation` indicator, so the gate cannot
   move the Linear status, attach a label, etc. when it parks a
   ticket. Triagers can't see "this is waiting on me" from the board.

## What Changes

- Add a `setAwaitingConfirmation` set-indicator (SetIndicator: one or
  more markers, same shape as `setInProgress` / `setConflicted`). When
  a change first enters `awaiting-confirmation`, the gate applies it
  alongside posting the plan-ready comment. Idempotent — keyed off
  `state.confirmation.awaitingMarkerAppliedAt`.
- Add a `clearAwaitingConfirmation` set-indicator (label-only, same
  shape as `clearApproved`). Applied when the gate releases for any
  reason (approved, revised, opt-out, tasks empty, or planning
  artifacts stubbed back out).
- Rewrite the hardcoded "📋 Ralphy plan ready" comment so it always
  enumerates the configured approval marker(s) (e.g. "apply the
  `ralph:approved` label" / "move status to `Approved`") and the
  revise syntax. The body remains hardcoded in source — only the
  interpolated values come from `cfg.linear.indicators.getApproved`
  and `cfg.linear.mentionHandle`.
- Document both indicators in the default `WORKFLOW.md` template
  (commented-out examples under the existing "Confirmation gate"
  section).

## Additional instructions

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
