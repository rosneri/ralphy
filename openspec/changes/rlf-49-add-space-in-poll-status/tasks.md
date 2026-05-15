# Tasks for RLF-49

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-49/add-space-in-poll-status and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Give the row-2 countdown `Box` in `apps/agent/src/components/AgentMode.tsx` an explicit `width={7}` so the `│` separator aligns with the row-1 `│`
- [x] Run `bunx openspec validate rlf-49-add-space-in-poll-status` and resolve any validator errors
- [x] Run `bun run lint`
- [x] Run `bun run test`
