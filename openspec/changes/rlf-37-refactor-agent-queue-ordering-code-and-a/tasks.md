# Tasks for RLF-37

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-37/refactor-agent-queue-ordering-code-and-add-tests and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Add `createdAt: string` to `LinearIssue` in `apps/agent/src/agent/linear.ts`; include `createdAt` in the GraphQL query in `fetchOpenIssues` and the `nodes.map` projection
- [x] Create `apps/agent/src/sort/compare.ts` exporting `Comparator<T>` and `chain(...cmps)` helper
- [x] Create `apps/agent/src/agent/queue-order.ts` exporting `SpawnMode`, `MentionTrigger`, `QueueEntry`, and `compareQueueEntries(getAutoMerge)` built from `chain()` over (auto-merge boost, priority, mode rank, createdAt asc)
- [x] Refactor `apps/agent/src/agent/coordinator.ts` to import the types from `queue-order.ts`, re-export `SpawnMode`/`MentionTrigger`, and replace the inline `this.queue.sort(...)` block with a call to `compareQueueEntries`
- [x] Refactor `apps/agent/src/list-sort.ts` to use the shared `chain()` helper (no behavior change)
- [x] Add `apps/agent/src/__tests__/queue-order.test.ts` covering: auto-merge boost beats priority; urgent beats medium; mode rank tiebreaker; FIFO tiebreaker within a bucket; no-priority sorts last; missing `getAutoMerge` is a no-op
- [x] Update `apps/agent/src/__tests__/coordinator.test.ts` `issue()` helper to set `createdAt` and add at least one assertion that FIFO order is honored across two same-priority same-mode issues
- [x] Update other tests that build `LinearIssue` literals (`agent.test.ts`, `mention-reaction.test.ts`, `post-task.test.ts`, `pr.test.ts`, `agent-integration.test.ts`) to include `createdAt`
- [x] Run `bun run lint` and fix any findings
- [x] Run `bun run test` and fix any failures
- [x] Run `bunx openspec validate rlf-37-refactor-agent-queue-ordering-code-and-a`
- [x] Stage modified files individually and commit; push branch and open PR
