# Tasks for RLF-64

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-64/logs-flicker-to-replace-view and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Create `packages/core/src/agent-mode/tail-layout.ts` exporting `MIN_TAIL_LINES`, `TailLayoutInput`, `TailLayout`, and `computeFocusedTailLayout`. Overhead must include header, poll row, tasks box (when activeCount > 1), pause banner, card chrome, steering box, current-task line, cmd line, phase-pipeline line, subtasks panel (1 header + rendered rows), progress bar, and 4 rows per non-focused sibling. Return `focusedTailLines = max(0, termHeight - overhead)` and `showOutputTail = focusedTailLines >= MIN_TAIL_LINES`.
- [x] Re-export `computeFocusedTailLayout` and `MIN_TAIL_LINES` from `packages/core/src/index.ts`.
- [x] Add `packages/core/src/__tests__/tail-layout.test.ts` covering: tall body + short terminal hides OUTPUT, ample terminal returns expected row budget, subtasks panel toggle flips visibility at boundary height, steering active adds 3 rows of overhead, sibling workers each cost 4 rows, `termHeight === 0` clamps to hidden.
- [x] Update `apps/agent/src/components/AgentMode.tsx`: import the helper, remove the `FIXED_OVERHEAD`/`focusedTailLines` block at ~line 740, compute the tail layout per focused-card render using the actual `subtasks`, `taskProgress`, `openspecPhase`, `currentTask`, `cmd`, and pause-banner state, and gate the OUTPUT block at ~line 1127 on `showOutputTail` (drop the `!(showPendingTasks && showAllSubtasks)` guard).
- [x] Run `bunx openspec validate rlf-64-logs-flicker-to-replace-view` and fix any reported issues.
- [x] Run `bun run lint` and `bun run test`; fix any failures.
- [x] Manually smoke-test the agent UI: with subtasks panel expanded and a short terminal, confirm there is no flicker when toggling Ctrl+T / Ctrl+Meta+T.

## Manual Testing

- [x] Short terminal + tall body (steering on, subtasks expanded, pause banner, progress bar): verify OUTPUT tail is suppressed entirely instead of flickering one frame of scrollback.
- [x] Tall terminal (~50 rows), baseline state: verify OUTPUT tail renders with the expected row budget (`termHeight - 20` lines) and no overflow scroll occurs.
- [x] Subtasks panel toggle: at a borderline terminal height (e.g. 23 rows), press Ctrl+T to show/hide the subtasks panel and confirm OUTPUT visibility flips cleanly with no flicker on either transition.
- [x] Toggle-all-subtasks (Ctrl+Meta+T) at a borderline terminal height: confirm the OUTPUT block hides/reveals based on the new rendered row count without redraw flicker.
- [x] Steering box activation: when a steering message is active, verify the 3 extra rows are subtracted from the OUTPUT tail (no overlap with the steering box).
- [x] Multiple concurrent workers (activeCount ≥ 2): verify the focused card's OUTPUT tail shrinks by ~9 rows for the first sibling and ~4 rows for each additional sibling so siblings render in full without clipping.
- [x] Terminal resize: drag the terminal smaller until OUTPUT disappears, then larger again, and confirm the transition is clean (no scrollback flicker, no stale frames).
- [x] Edge case `termHeight === 0` (e.g. SIGWINCH burst): confirm the renderer does not crash and OUTPUT is hidden until the next valid measurement.
