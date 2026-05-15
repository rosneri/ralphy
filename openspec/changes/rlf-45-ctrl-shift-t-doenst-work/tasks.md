# Tasks for RLF-45

## Planning

- [ ] Read the Linear issue at https://linear.app/neriros/issue/RLF-45/ctrl-shift-t-doenst-work and research the codebase to understand the mission and its scope
- [ ] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [ ] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [ ] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [ ] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [ ] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)
