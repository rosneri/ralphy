# RLF-71: Tasks sync comment shows the agent tasks

Source: [RLF-71](https://linear.app/neriros/issue/RLF-71/tasks-sync-comment-shows-the-agent-tasks)
Status: In Progress
Assignee: Neriya Rosner

## Why

The Linear "📝 Tasks" sticky comment currently mirrors the entire `tasks.md`, which includes the `## Planning` section that the scaffold injects (read the issue, fill in proposal.md, append `## Implementation`, etc.). Those are agent-internal bookkeeping items — they are noise to humans following the Linear thread, who only care about the actual mission tasks the agent extracted (the `## Implementation` section and any later mission-specific sections).

## What Changes

- `renderTasksBlock` in `apps/agent/src/agent/linear-sync/index.ts` skips the `## Planning` section (case-insensitive heading match) so the synced Linear comment shows only mission tasks.
- If, after filtering, no sections remain (e.g. very early iterations where only Planning exists), the rendered block now emits a short "_No mission tasks yet — planning in progress._" placeholder instead of an empty body, so the comment stays informative.
- Tests in `apps/agent/src/__tests__/linear-tasks-sync.test.ts` cover both the filtering and the placeholder cases.

## Description

the task sync should only sync the actual tasks instead of the agent tasks

## Additional instructions

You are working on RLF-71: Tasks sync comment shows the agent tasks.

the task sync should only sync the actual tasks instead of the agent tasks

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
