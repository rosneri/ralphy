# Tasks for RLF-36

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-36/apply-fifo-age-sorting-within-each-agent-queue-bucket and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Extend `LinearIssue` (and the GraphQL `issues` query / mapping) in `apps/agent/src/agent/linear.ts` with `createdAt: string`
- [x] Add createdAt-ascending tiebreaker to the queue sort in `apps/agent/src/agent/coordinator.ts`
- [x] Extend `SortableRow` in `apps/agent/src/list-sort.ts` with `issueCreatedAt` and order tier ties by it
- [x] Populate `issueCreatedAt` on `UnifiedRow` in `apps/agent/src/list.ts`
- [x] Update LinearIssue test fixtures (`pr.test.ts`, `post-task.test.ts`, `agent.test.ts`, `mention-reaction.test.ts`, `agent-integration.test.ts`, `coordinator.test.ts`) and FakeLinear GraphQL output to include `createdAt`
- [x] Add a coordinator test asserting FIFO ordering within a priority/mode bucket
- [x] Add a list-sort test asserting `issueCreatedAt` ordering within a tier
- [x] Add an `agent-queue-fifo` capability spec under `specs/` documenting the new requirement + scenarios
- [x] Run `bun run lint`
- [x] Run `bun run typecheck` and `bunx nx test agent`
- [x] Run `bunx openspec validate rlf-36-apply-fifo-age-sorting-within-each-agent`
