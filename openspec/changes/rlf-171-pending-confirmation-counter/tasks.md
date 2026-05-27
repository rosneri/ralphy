# Tasks for RLF-171

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-171/pending-confirmation-counter and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Export `pickLatestGatedTicket` helper from `apps/agent/src/components/AgentMode.tsx` — takes a `Map<string, { since: string | null }>` and returns `{ top: [string, T] | null; moreCount: number }` selecting the entry with the newest `since`
- [x] Update the gated-tickets render block in `AgentMode.tsx` to call `pickLatestGatedTicket` and render only the single latest `[GATE]` card instead of all entries
- [x] When `moreCount > 0`, render a dimmed `+{moreCount} more awaiting confirmation` line below the single `[GATE]` card
- [x] Add `describe("pickLatestGatedTicket", ...)` tests to `apps/agent/src/__tests__/pending-tasks.test.ts` covering: empty map, single ticket, multiple tickets (newest wins), null `since` treated as oldest
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and ensure all tests pass
