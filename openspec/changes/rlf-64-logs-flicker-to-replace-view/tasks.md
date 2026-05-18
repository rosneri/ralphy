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
