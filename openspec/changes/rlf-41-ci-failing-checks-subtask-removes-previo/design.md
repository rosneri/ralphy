# Design for RLF-41

## Goal

When the agent prepends a `## Fix failing CI checks` section to `tasks.md`, the
SUBTASKS dashboard panel must keep both the new fix task and any previously
unchecked mission tasks visible — even after iterations have accumulated many
`- [x]` completed items above them.

## Files touched

- `apps/agent/src/components/AgentMode.tsx` — in the SUBTASKS render block
  (around line 1053), partition the `subtasks` array into `[unchecked, …,
done, …]` (each group stable in file order) before applying the
  `MAX_PENDING_DISPLAY` slice. The expanded view (`Ctrl+Shift+T`) is
  unchanged — it always shows every subtask in file order.

- `apps/agent/src/__tests__/pending-tasks.test.ts` — extend with a case
  that simulates a `tasks.md` containing prepended `## Fix failing CI checks`
  - an older section with mixed `- [x]` and `- [ ]` items, and asserts that
    unchecked items come first in the parsed-then-ordered list used by the
    panel.

No changes to:

- `packages/core/src/tasks-md.ts` — `prependSection` / `prependFixTask`
  already preserve previous sections correctly.
- `apps/agent/src/agent/post-task.ts` — already calls `prependFixTask`
  rather than rewriting `tasks.md`.

## Data flow

```
tasks.md  ──(parseSubtasks)──▶  subtasks: { done, text }[]   // file order
                                       │
                                       ▼
                             partition by `done`               // new
                                       │
                                       ▼
                             slice(0, MAX_PENDING_DISPLAY)
                                       │
                                       ▼
                                SUBTASKS panel render
```

## Edge cases

- **No unchecked items**: the panel still renders completed items oldest-cap-first,
  as today (no functional regression).
- **More than 15 unchecked items**: the cap truncates the _oldest_ unchecked
  items (since the newest sit at the top of the file via `prependFixTask`).
  The new "Fix failing CI checks" task is therefore always visible.
- **Expanded mode (`Ctrl+Shift+T`)**: bypasses the slice, so it also bypasses
  the reorder — the operator sees the literal file order for diagnostics.
