# RLF-61: Todo list collapse by default

Source: [RLF-61](https://linear.app/neriros/issue/RLF-61/todo-list-collapse-by-default)
Status: Done
Assignee: Neriya Rosner

## Why

The PROGRESS panel renders a grouped todo list (checkbox items grouped by section). When a task has many sections and items, the panel becomes a long scroll and it's hard to scan which sections exist or jump to one. Collapsing sections by default lets users see the overall structure at a glance and expand only the section they care about.

## What Changes

- `ProgressList` renders each section header as a clickable disclosure that toggles the section's items.
- All sections start collapsed by default; only section headers (and the item count) are visible until the user expands them.
- Clicking a section header toggles its expanded state; the chosen state is local component state (no persistence).
- Empty state behavior (no items) is preserved.

## Description

Make the todo list collapsed by default — sections in the PROGRESS panel begin collapsed, showing only the section title and item count. Users click a header to reveal the underlying todo items.

## Additional instructions

You are working on RLF-61: Todo list collapse by default.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
