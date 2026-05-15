# Design for RLF-13

## Files to touch

- `apps/agent/src/agent/pr-status.ts` (new) — `fetchPrStatus(url, runner, cwd)` returning a typed
  `PrStatus` (state, isDraft, mergeable, ciBucket, autoMergeEnabled, createdAt). Owns the single
  `gh pr view --json state,isDraft,mergeable,mergeStateStatus,statusCheckRollup,autoMergeRequest,createdAt`
  call and maps `statusCheckRollup` to the same pass/fail/pending buckets used by
  `agent/ci.ts::getPrChecksStatus`. Returns a sentinel `{ kind: "error", message }` shape on `gh`
  failure so the caller can render `?` without breaking the table.
- `apps/agent/src/list.ts` — replace the per-bucket Linear printing with:
  1. fan-out: fetch issues for every configured bucket in parallel (existing `fetchBucketIssues`)
     and merge into a single list, tagging each issue with its bucket label (for display);
  2. resolve PR URL via `fetchIssueAttachments` (existing `findPullRequestUrl`);
  3. for each PR URL, call `fetchPrStatus`;
  4. assign a tier (1–5) per the issue's prioritization rules;
  5. sort by `(tier asc, createdAt asc, identifier asc)`;
  6. print one unified table with columns: Identifier, Bucket, State, Title, PR Status, PR URL.
- `apps/agent/src/__tests__/pr-status.test.ts` (new) — unit tests for `fetchPrStatus` mapping
  (mock `CmdRunner`).
- `apps/agent/src/__tests__/list-sort.test.ts` (new) — unit tests for the tier-assignment and
  sort helper (pure function, no I/O).

## Data flow

```
Linear buckets ──fan-out──►  IssueWithBucket[]
                              │
                              ├─ findPullRequestUrl (existing)
                              │
                              ▼
                          fetchPrStatus  ──gh pr view ──►  PrStatus | { kind: "error" }
                              │
                              ▼
                          assignTier + sort
                              │
                              ▼
                          render unified table
```

## Tier assignment

```
tier 1: status.mergeable === "CONFLICTING" && status.autoMergeEnabled
tier 2: status.ciBucket === "fail"           && status.autoMergeEnabled
tier 3: status.mergeable === "CONFLICTING"
tier 4: status.ciBucket === "fail"
tier 5: everything else (including no-PR, errored gh, draft, pending, pass)
```

`createdAt` for tie-breaking comes from the PR's `createdAt`. For rows without a PR we fall back to
the Linear issue order returned by the buckets (stable).

## Edge cases

- **No `gh` auth / network error** — `fetchPrStatus` returns `{ kind: "error" }`; row shows `?` in
  the PR Status column and sorts into tier 5. We don't propagate the throw because one bad PR
  shouldn't break the whole table.
- **PR closed/merged** — still printed with a `closed` / `merged` marker; tier 5.
- **Draft PRs** — surfaced as `draft` marker; conflict/CI markers still applied if relevant (a
  conflicted draft on auto-merge still sorts into tier 1, since the issue spec doesn't exclude
  drafts).
- **Issue appears in multiple buckets** — already deduped today by the per-bucket fetch using
  the Linear filter set; we additionally dedupe in the merged list by issue `id`.
- **`mergeable` is `UNKNOWN`** — GitHub hasn't computed mergeability yet; treat as "not
  conflicted" for tiering (tier 5) but render `?merge` so the user knows.
- **`statusCheckRollup` is `null`** — no checks have run yet; treat as "pending" if the PR is
  open, "pass" if merged.

## Why a single `gh pr view` per PR (not `gh pr checks` + `gh pr view`)

`gh pr view` already returns `statusCheckRollup` in one round trip — exactly what we need for a
listing view. Reusing the richer `getPrChecksStatus` from `agent/ci.ts` would cost an extra `gh`
invocation per PR with no benefit at the list level (we don't need failing-run IDs).

## Concurrency

`fetchPrStatus` calls are done with `Promise.all` over the merged issue list. `agent list` is
interactive and the typical N is small (<20 active agents). No throttling needed at this scale.
