# RLF-41: CI failing checks subtask removes previous tasks

Source: [RLF-41](https://linear.app/neriros/issue/RLF-41/ci-failing-checks-subtask-removes-previous-tasks)
Status: In Progress
Assignee: Neriya Rosner

## Why

When CI fails on a PR, the agent's post-task pipeline prepends a `## Fix failing CI checks` section to `tasks.md`. The SUBTASKS panel in the agent-mode dashboard (`AgentMode.tsx`) caps the rendered list at `MAX_PENDING_DISPLAY = 15` items (`subtasks.slice(0, MAX_PENDING_DISPLAY)`).

After many iterations a change accumulates a long run of `- [x]` completed items. Those completed items are read top-to-bottom by `parseSubtasks` and consume the visible 15-row budget, so the operator sees a wall of `[x]` and an ellipsis `… +N more` while the actually-pending `Fix failing CI checks` task (and any prior unchecked mission tasks) are hidden below the cap.

The operator's complaint: "previous tasks (the unchecked ones I still owe) are hidden when we add Fix failing CI checks, and the newest tasks aren't at the top."

## What Changes

- Reorder the SUBTASKS panel render in `apps/agent/src/components/AgentMode.tsx` so that **unchecked items appear before completed items** (stable within each group), then slice to `MAX_PENDING_DISPLAY`. The newest fix task — always prepended at the top of `tasks.md` — is therefore always visible at the top of the panel, alongside any older unchecked tasks. The ellipsis only ever truncates completed items.
- Cover the new ordering with a unit test in `apps/agent/src/__tests__/pending-tasks.test.ts`.

## Acceptance criteria

- After `prependFixTask("Fix failing CI checks", …)` adds a new unchecked item, the SUBTASKS panel shows that item at row 1, followed by any other unchecked items (in file order), followed by completed items.
- When the total exceeds `MAX_PENDING_DISPLAY`, the `+N more` ellipsis truncates only the trailing completed items — every unchecked item remains visible (until the unchecked count alone exceeds the cap, in which case the oldest unchecked items truncate first, but the newest fix task is still at row 1).
- `bun run lint` and `bun run test` pass; coverage threshold is not lowered.

## Out of scope

- Changing `prependFixTask` / `prependSection` (already preserves previous sections — only the display layer is being touched).
- Changing the `Ctrl+Shift+T` expand behavior (when expanded, all items still render in file order, as today).
- Changing `firstUnchecked` (used by the worker to pick a task) — that already returns the topmost section with unchecked items.

## Steering

_Add steering notes here as the loop runs._
