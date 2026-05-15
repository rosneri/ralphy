# Tasks for RLF-45

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-45/ctrl-shift-t-doenst-work and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Swap the `Ctrl+Shift+T` branch in `apps/agent/src/components/AgentMode.tsx` `useInput` handler for `key.ctrl && key.meta && (input === "t" || input === "T")`, evaluated before the plain `Ctrl+T` branch
- [x] Update the JSDoc on `orderSubtasksForCappedDisplay` and the `showAllSubtasks` state declaration to reference `Ctrl+Alt+T`
- [x] Update the truncated subtask list footer string to read `(CTRL+ALT+T to expand)`
- [x] Run `bun run lint`
- [x] Run `bun run test`
- [x] Manual smoke: launch `ralph agent`, queue subtasks past the cap, confirm `Ctrl+Opt+T` toggles expand and `Ctrl+T` still toggles the pending-tasks panel
