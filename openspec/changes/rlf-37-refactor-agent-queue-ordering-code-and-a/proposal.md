# RLF-37: Refactor agent queue ordering code and add tests

Source: [RLF-37](https://linear.app/neriros/issue/RLF-37/refactor-agent-queue-ordering-code-and-add-tests)
Status: In Progress

## Problem

Follow-up to [RLF-36](https://linear.app/neriros/issue/RLF-36/apply-fifo-age-sorting-within-each-agent-queue-bucket).

The queue-ordering logic in `apps/agent/src/agent/coordinator.ts` lives as an inline comparator inside `pollOnce` that mixes four concerns (auto-merge boost, Linear priority, spawn-mode rank, intended FIFO age tiebreaker). It is unnamed, has no direct unit tests, and duplicates the comparator-chain pattern already present in `apps/agent/src/list-sort.ts`. RLF-36 has not landed on `main` either — the FIFO `createdAt` tiebreaker is not yet implemented on this branch.

## Approach

1. Add `createdAt: string` to `LinearIssue` and fetch it from the Linear GraphQL API (the FIFO data dependency).
2. Extract queue ordering into a new module `apps/agent/src/agent/queue-order.ts` that exports:
   - `SpawnMode`, `MentionTrigger`, `QueueEntry` types (moved out of coordinator so the comparator can own them without an import cycle).
   - `compareQueueEntries(getAutoMerge)` — a named comparator implementing the documented order: auto-merge conflict-fix first → Linear priority (1=Urgent first, 0=No-priority last) → spawn-mode rank (resume<conflict-fix<review<fresh) → createdAt asc (FIFO).
3. Introduce a tiny shared comparator-chain helper at `apps/agent/src/sort/compare.ts` and use it from both `queue-order.ts` and `list-sort.ts` to remove the duplicated multi-key sort scaffolding.
4. Update `coordinator.ts` to import the types + comparator and re-export `SpawnMode`/`MentionTrigger` so callers' imports do not change.
5. Add focused unit tests for `queue-order.ts` covering each tier of the ordering and the FIFO tiebreaker.
6. Update existing coordinator tests so the local `issue()` helper carries a `createdAt`, and keep the auto-merge / priority / mode integration tests green.

## Acceptance criteria

- `LinearIssue.createdAt` is fetched from Linear and populated on every issue handed to the coordinator.
- Queue ordering is implemented by a single named comparator in `queue-order.ts`, called from `coordinator.ts`; the old inline `this.queue.sort(...)` block is gone.
- A shared `chain()` comparator helper is used by both `queue-order.ts` and `list-sort.ts` — no duplicated multi-key sort scaffolding.
- New `__tests__/queue-order.test.ts` covers: auto-merge boost beats priority; urgent beats medium; mode-rank tiebreaker; FIFO tiebreaker within a (priority, mode) bucket; no-priority sorts last.
- `bun run lint` and `bun run test` pass.

## Steering

_Add steering notes here as the loop runs._
