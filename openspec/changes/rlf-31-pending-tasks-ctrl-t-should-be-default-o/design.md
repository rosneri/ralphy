# Design for RLF-31

## Files touched

- `apps/agent/src/components/AgentMode.tsx`
  - Default state: `useState(true)` for `showPendingTasks` (currently `false`, line ~307).
  - Replace `parsePendingTasks(tasksMd): string[]` with a new `parseSubtasks(tasksMd): Array<{ done: boolean; text: string }>` returning all `- [ ]` and `- [x]` items in order. Keep `parsePendingTasks` as a thin wrapper that returns the unchecked text, since `currentTask` derivation in the polling loop still uses "first pending" semantics (line ~556–558). Or refactor that call site to filter the new parser's result — preferred, simpler.
  - `WorkerMeta.pendingTasks: string[]` becomes `WorkerMeta.subtasks: Array<{ done: boolean; text: string }>`. Update the initial empty state (line ~383) and the polling assignment (line ~557).
  - Card header (line ~970–979): remove the `│ Ctrl+T tasks …` segment.
  - Progress bar block (line ~981–1004): move out from under the header and render at the _bottom_ of the card, gated on `!showPendingTasks`. Append a dim `CTRL+T to open` next to the `#/#` count.
  - Subtasks panel (line ~1051–1069): rename `PENDING TASKS` to `SUBTASKS`, append `CTRL+T to close` to the header band, render every subtask with its `[x] ` / `[ ] ` prefix (use `chalk`-free Ink coloring: dim for `[x]`, normal for `[ ]`). Keep `MAX_PENDING_DISPLAY` cap.
- `apps/agent/src/__tests__/pending-tasks.test.ts`
  - Update tests to cover the new `parseSubtasks` shape: returns ordered list with `done` flags for both `[x]` and `[ ]` lines; ignores non-task lines; trims whitespace.

## Data flow

1. Polling loop reads `tasks.md` for each worker (existing `tasksText` fetch around line ~554).
2. `parseSubtasks(tasksText)` produces the full ordered list. `meta.subtasks = ...`.
3. `meta.currentTask = subtasks.find((s) => !s.done)?.text ?? null` (replaces the old `pending[0]`).
4. Render path uses `meta.subtasks` directly for the panel and uses `taskProgress` (unchanged, still derived from `countProgress(tasksText)`) for the progress bar.

## Layout when panel is open (default)

```
╭─ TITLE  [BADGE]  PHASE │ 3m12s │ ↺ 4 ───────────────╮
│ ▶ TASK [phase: ...] first pending task              │
│ ⏵ CMD bun run lint                                  │
│ ─ OUTPUT ─────────────────                          │
│ │ log line 1                                        │
│ ─ SUBTASKS (5) CTRL+T to close ────────             │
│ · [x] done task 1                                   │
│ · [x] done task 2                                   │
│ · [ ] pending task                                  │
╰─────────────────────────────────────────────────────╯
```

## Layout when panel is closed

```
╭─ TITLE  [BADGE]  PHASE │ 3m12s │ ↺ 4 ───────────────╮
│ ▶ TASK [phase: ...] first pending task              │
│ ⏵ CMD bun run lint                                  │
│ ─ OUTPUT ─────────────────                          │
│ │ log line 1                                        │
│ [██░░░░░ 2/5 ░░░░░░░░░░░░░] CTRL+T to open          │
╰─────────────────────────────────────────────────────╯
```

## Edge cases

- `tasks.md` not yet loaded or empty: panel renders nothing (existing guard `subtasks.length > 0`); when closed, progress bar also returns null because `taskProgress` is null — no changes needed.
- Worker has zero pending items (all `[x]`): panel still renders the full done list; current task falls back to `null` and the `▶ TASK` row is hidden.
- Very long lists: existing `MAX_PENDING_DISPLAY` cap of 15 still applies; overflow message becomes `… +N more`.
- Narrow terminal: existing `trunc` on each line still applies.
- Backwards compatibility: no external consumers — `parsePendingTasks` is only exported for the unit test, so renaming is safe.
