# Design for RLF-59

## Touched files

- `apps/agent/src/agent/wire.ts`
  - Add closure-scope `Map<string, string>` named
    `lastHandledReviewActivity`, alongside the existing `stalePingedAt`
    map declared near `wire.ts:580`.
  - Modify `scanCodeReview` (`wire.ts:1464-1498`) to read+write that map.
- `apps/agent/src/__tests__/` — new test file
  `code-review-trigger-dedupe.test.ts` covering the three scenarios in the
  spec delta.

## Approach

`scanCodeReview` today:

```ts
const newestReviewerActivity = unresolved.reduce(...);
if (!lastRalphPickup || newestReviewerActivity > lastRalphPickup) {
  return { source: "github-review", ... };
}
```

New body (sketch):

```ts
const newestReviewerActivity = unresolved.reduce(...);
const lastHandled = lastHandledReviewActivity.get(prUrl) ?? null;
const effectiveLastHandled =
  lastRalphPickup && lastHandled
    ? (lastRalphPickup > lastHandled ? lastRalphPickup : lastHandled)
    : (lastRalphPickup ?? lastHandled);
if (effectiveLastHandled && newestReviewerActivity <= effectiveLastHandled) {
  await maybePingStaleReviewer(...);
  return null;
}
const trigger = { source: "github-review", ... };
lastHandledReviewActivity.set(prUrl, newestReviewerActivity);
return trigger;
```

The map is owned by the same factory closure that owns `stalePingedAt`,
`prByChange`, `prByPinged`, etc., so it inherits their lifecycle (cleared
on agent restart — intentional, because the Linear pickup comment is the
durable cross-restart fallback).

## Data flow

1. Poll fires → `fetchMentions` → `scanCodeReview(issue, prUrl, lastRalphPickup)`.
2. `scanCodeReview` computes `newestReviewerActivity`.
3. Take the max of `lastRalphPickup` (Linear sentinel) and
   `lastHandledReviewActivity.get(prUrl)` (in-process sentinel) and compare.
4. If `newestReviewerActivity` does not exceed it → return `null`.
5. Otherwise, set the in-process sentinel to `newestReviewerActivity` and
   return the trigger.

No state file or schema changes — purely in-process.

## Edge cases

- **Agent restart**: in-process map is empty. The Linear `🔁 Ralph picked up`
  sentinel still does its job (the durable fallback). If `postComments: false`
  AND restart, one re-fire is possible — acceptable, because restart is rare
  and the alternative (persisting per-PR state to disk) is heavier than the
  fix warrants.
- **PR URL changes / branch rename**: `prByChange` already handles discovery,
  so the URL we key on is stable post-discovery.
- **Comparing ISO timestamps as strings**: existing code already does this
  (e.g. `c.createdAt <= lastRalphPickup` at `wire.ts:1376`), so the
  comparison stays consistent across the file.
- **`maybePingStaleReviewer` interaction**: today's code calls it only when
  no trigger fires. The new short-circuit path must still call it so stale
  reviewers continue to get pinged after the dedupe guard kicks in.
- **Concurrency**: the agent poll is serial within a single process; no lock
  needed on the map.
