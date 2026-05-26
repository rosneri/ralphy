# Tasks for RLF-163

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-163/remove-working and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Remove `ActivityChip` type, `activityChipColor`, and `deriveActivityChip` from `apps/agent/src/components/AgentMode.tsx`
- [x] Remove the activity chip JSX render block (the `[${chip}]` block) from `apps/agent/src/components/AgentMode.tsx`
- [x] Update `apps/agent/src/__tests__/agent-mode-chip.test.tsx`: remove the `[working]` assertion, keep the phase pipeline assertions, update describe/test names
- [x] Run `bun run lint` and verify it passes
- [x] Run `bun run test` and verify it passes
