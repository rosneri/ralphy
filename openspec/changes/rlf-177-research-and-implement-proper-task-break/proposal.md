# RLF-177: Research and implement proper task breakdown methodology

Source: [RLF-177](https://linear.app/neriros/issue/RLF-177/research-and-implement-proper-task-breakdown-methodology)
Status: Todo

## Why

Ralphy should break work down into a proper, exhaustive sequence of small tasks instead of producing partial checklists.

Research well-known methodologies for task decomposition and execution planning, evaluate which approach fits best, and decide on one methodology or a combination of methods to use.

The outcome should improve how work is broken down so tasks are small, complete, ordered, and practical to execute one by one.

## What Changes

- `packages/content/phases/plan.md` — Replace the generic "Create PROGRESS.md" guidance with a 6-step atomic decomposition algorithm: (1) build a change inventory from RESEARCH.md listing every affected symbol per file, (2) expand each change to one item per atomic unit (one function, one type, one file), (3) enumerate every caller of changed interfaces as explicit items, (4) add a TDD test item immediately after each behavior-changing implementation item, (5) order all items by dependency (topological), and (6) run a completeness audit before committing
- `packages/content/checklists/task-completeness.md` — New checklist agents append to PROGRESS.md after drafting; covers types/schema, implementation, callers, tests, and verification categories so nothing is silently skipped
- `packages/content/scaffolds/PROGRESS.md` — Update scaffold to show the atomic item pattern with TDD pairs and explicit file paths, so agents see the target format
- `packages/content/scaffolds/PLAN.md` — Add a `## Traceability` section mapping each functional requirement to its implementation items

## Additional instructions

You are working on RLF-177: Research and implement proper task breakdown methodology.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
