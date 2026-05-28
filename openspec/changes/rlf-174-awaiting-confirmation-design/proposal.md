# RLF-174: Awaiting confirmation design

Source: [RLF-174](https://linear.app/neriros/issue/RLF-174/awaiting-confirmation-design)
Status: Todo
Assignee: Neriya Rosner

## Why

When multiple tickets are gating simultaneously, the current UI shows only the most-recently-gated ticket in the card and appends a dim "+N more awaiting confirmation" line below. This forces the user to run a separate command to identify which other tickets need attention. A horizontal list of all ticket identifiers as clickable links gives the full picture at a glance without leaving the status view.

## What Changes

- When exactly one ticket is awaiting confirmation, the card label and body remain unchanged (single identifier as a link, round counter, asked-ago, title snippet).
- When two or more tickets are awaiting confirmation, the card label is replaced by a horizontal list of all gated ticket identifiers as clickable links separated by `·` (e.g. `LIT-42 · LIT-43 · LIT-44`). The card body is simplified to show only the count.
- The "+N more awaiting confirmation" dim text that previously appeared below the card is removed entirely.

## Additional instructions

You are working on RLF-174: Awaiting confirmation design.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
