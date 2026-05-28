# Tasks for RLF-182

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-182/confirmation-mode and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Update `openspec/specs/linear-spec-attachments/spec.md`: replace the "Sync MUST upload `proposal.md` and `design.md` on first run" requirement and its stale scenarios with the new design-only requirement (scenarios referencing normal proposal uploads must be removed or updated to match actual behavior)
- [x] Run `bun run test` in `apps/agent` and confirm all spec-attachment tests pass (including `linear-spec-attachments-design-only.test.ts`, `linear-spec-attachments-adopt.test.ts`, and `linear-spec-attachments.test.ts`)
- [x] Run `bun run lint` from the repo root and confirm no lint errors
