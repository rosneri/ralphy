# Design for RLF-37

## Files

### New

- `apps/agent/src/sort/compare.ts` — generic `Comparator<T>` and `chain(...cmps)` helper.
- `apps/agent/src/agent/queue-order.ts` — types and comparator for the coordinator queue.
- `apps/agent/src/__tests__/queue-order.test.ts` — unit tests for the comparator.

### Modified

- `apps/agent/src/agent/linear.ts` — add `createdAt: string` to `LinearIssue`; include it in the GraphQL query and the `nodes.map` projection.
- `apps/agent/src/agent/coordinator.ts` — move `SpawnMode`, `MentionTrigger`, and the queue-entry shape into `queue-order.ts`; re-export them; replace the inline `this.queue.sort(...)` with `this.queue.sort(compareQueueEntries(this.opts.getAutoMerge))`.
- `apps/agent/src/list-sort.ts` — refactor the multi-key sort to use the shared `chain()` helper. Behavior unchanged.
- `apps/agent/src/__tests__/coordinator.test.ts` — extend the `issue()` helper to set `createdAt` (default to a fixed timestamp).
- Other tests that construct `LinearIssue` literals (`agent.test.ts`, `mention-reaction.test.ts`, `post-task.test.ts`, `pr.test.ts`, `agent-integration.test.ts`) — add `createdAt` where the type now requires it.

## Comparator chain (queue-order)

```ts
compareQueueEntries(getAutoMerge) = chain(
  byAutoMergeBoost(getAutoMerge), // conflict-fix + auto-merge first
  byLinearPriority, // 1=Urgent first; 0=No-priority last
  bySpawnModeRank, // resume < conflict-fix < review < fresh
  byCreatedAtAsc, // FIFO (RLF-36)
);
```

Each leaf comparator is a small named function; `chain` returns 0 only when every leaf does. Array `.sort` is stable in V8/JSC, so equal entries keep insertion order — fine for the rare case of two issues sharing every key including `createdAt`.

## Data flow

1. `fetchOpenIssues` (and other Linear fetches that build `LinearIssue`) request `createdAt` from the GraphQL API.
2. The coordinator enqueues `{ issue, mode, trigger? }` tuples per bucket exactly as before.
3. After enqueueing, it calls `this.queue.sort(compareQueueEntries(this.opts.getAutoMerge))` instead of the inline comparator.
4. `spawnNext()` shifts entries off the head — workers are launched oldest-first inside each priority/mode bucket.

## Edge cases

- **Missing `createdAt`** — type-required `string`. Tests use a fixed timestamp; production always receives an ISO timestamp from Linear, so no defaulting is needed.
- **Empty queue / single entry** — `.sort` is a no-op; chain is never invoked.
- **Auto-merge boost without `getAutoMerge` configured** — `issueMatchesGetIndicator(issue, undefined)` returns `false`, so the boost comparator is a no-op and the rest of the chain decides ordering.
- **list-sort tier-5 rows** — `chain()` preserves the existing fallthrough (`createdAt` empty-string for null/error status sorts before any ISO; secondary `bucketOrder` then `identifier` keep behavior).
- **Tests that build `LinearIssue` literals** — every site touched gets `createdAt` so the type stays strict; the interface is not weakened.

## Risk

Low. The refactor is local to two files plus one new module; behavior is preserved (and the FIFO change matches the documented RLF-36 spec). The new comparator tests lock in the contract.
