# RLF-171: Pending confirmation counter

Source: [RLF-171](https://linear.app/neriros/issue/RLF-171/pending-confirmation-counter)
Status: In Progress
Assignee: Neriya Rosner

## Why

The TUI dashboard renders a full `[GATE]` card for every ticket in the awaiting-confirmation state. When multiple tickets are gated simultaneously, the display becomes cluttered and active worker cards can be pushed off-screen. The fix is to show at most one `[GATE]` card (the latest — whose plan-ready comment was posted most recently) and add a compact counter for the rest, keeping the dashboard legible regardless of how many tickets await human confirmation.

## What Changes

- Export a new helper `pickLatestGatedTicket` from `AgentMode.tsx` that selects the single most-recently-gated ticket from the gated-tickets map and computes how many more remain.
- The TUI gated-tickets section caps display to 1 full `[GATE]` card; when N > 1 tickets are gated a dimmed `+N more awaiting confirmation` line follows the card.
- Tests for `pickLatestGatedTicket` added to `pending-tasks.test.ts`.

## Additional instructions

You are working on RLF-171: Pending confirmation counter.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
