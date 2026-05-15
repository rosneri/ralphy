# RLF-49: Add space in poll status

Source: [RLF-49](https://linear.app/neriros/issue/RLF-49/add-space-in-poll-status)
Status: In Progress
Assignee: Neriya Rosner

## Why

The POLL STATUS box in the agent dashboard renders two rows:

- Row 1: `spinner` ␣␣ `Idle` ␣␣ `│` ␣␣ `todo …`
- Row 2: `↺ 33s` ␣␣ `│` ␣␣ `mergeable …`

The first column of row 2 (`↺ 33s`, 5 visible columns) is narrower than
the first column of row 1 (`spinner` + gap + `Idle` ≈ 7 visible columns
in the typical idle state), so the `│` separator in row 2 sits two
columns to the left of the `│` above it. Operators glance at the box
and see a visibly jagged separator.

The placeholder branch already pads the first column to 7 spaces — the
countdown branch should match so the pipe lines up with row 1.

## What Changes

- Align the row-2 pipe with the row-1 pipe in the POLL STATUS box by
  giving the `↺ <secs>s` segment a fixed visual width of 7 columns, the
  same width already used by the `" ".repeat(7)` placeholder branch.

## Description

in second row of poll status in the first column ↺ 33s make it so the pipe is aligned with the pipe above

## Additional instructions

You are working on RLF-49: Add space in poll status.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
