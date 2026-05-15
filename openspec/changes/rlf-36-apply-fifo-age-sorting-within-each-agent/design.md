# Design for RLF-36

## Data flow

1. `fetchOpenIssues` in `apps/agent/src/agent/linear.ts` requests `createdAt` from Linear's issue node and maps it onto `LinearIssue.createdAt` (ISO-8601 string).
2. `AgentCoordinator.pollOnce` already enqueues issues per-bucket, then runs a final stable sort on `this.queue`. Append a tertiary comparator: `String#localeCompare` on `issue.createdAt` ascending (ISO-8601 strings sort lexicographically as time-ordered).
3. The `ralph list` table renders `UnifiedRow`s sorted by `sortRows`. Extend `SortableRow` with `issueCreatedAt` (issue-level age — used for fairness within a tier) and use it after `tier` in the comparator chain. PR `createdAt` remains as a deeper tiebreaker so existing list-sort tests keep their semantics for the PR-status-driven cases that don't have an issue createdAt (legacy `bucketOrder`-only rows still work because they share `""`).

## Files to touch

- `apps/agent/src/agent/linear.ts` — extend `LinearIssue` + `LinearNode` with `createdAt`, request it in the GraphQL `issues` query.
- `apps/agent/src/agent/coordinator.ts` — add the createdAt comparator to the sort.
- `apps/agent/src/list-sort.ts` — add `issueCreatedAt` to `SortableRow`; comparator order becomes `tier → issueCreatedAt → prCreatedAt → bucketOrder → identifier`.
- `apps/agent/src/list.ts` — populate `issueCreatedAt: issue.createdAt` on `UnifiedRow`.
- `apps/agent/src/__tests__/coordinator.test.ts` — new test asserting FIFO order within a priority bucket; update the `issue()` helper to accept/emit `createdAt`.
- `apps/agent/src/__tests__/list-sort.test.ts` — new test asserting `issueCreatedAt` ordering within a tier; update existing rows to carry the new field.
- `apps/agent/src/__tests__/pr.test.ts`, `post-task.test.ts`, `agent.test.ts`, `mention-reaction.test.ts`, `agent-integration.test.ts` — add `createdAt` to test issue fixtures / FakeLinear payloads.

## Edge cases

- **Missing `createdAt`**: GraphQL returns it for all real issues. Map to empty string defensively (`n.createdAt ?? ""`); the comparator falls through gracefully for missing values.
- **Same-second creation**: `localeCompare` returns 0 and the sort remains stable (Bun/V8 sort is stable), preserving Linear fan-out order as the final tiebreaker.
- **List rows with no PR**: PR `createdAt` is empty for these; the new `issueCreatedAt` becomes the meaningful within-tier signal, with `bucketOrder` / `identifier` as deeper fallbacks.
- **Resume/conflict-fix issues**: they keep their existing priority lane (resume < conflict-fix < review < fresh via `modeRank`) — FIFO only kicks in for ties in (auto-merge, priority, mode), so we never delay a resume behind an older fresh issue.
