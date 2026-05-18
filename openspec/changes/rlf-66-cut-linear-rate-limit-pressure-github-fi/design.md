# Design for RLF-66

## Files touched

- `apps/agent/src/agent/wire.ts`
  - New `discoverPrUrlFromGitHub(issue)` helper (above `discoverPrUrlFromLinear` near line 1330).
  - `discoverPrUrl` (currently at ~line 1196): switch primary path from `gh pr list --head <branch>` + Linear attachments to **GitHub title/branch search first**, then Linear attachments fallback. Keep the `prUnavailable` soft-TTL behavior.
  - `resolvePrUrlForIssue` (currently at ~line 1735): drop the change-name-keyed `prByChange` short-circuit in favor of (or in addition to) a new issue-id-keyed `prUrlByIssue` cache with 5-min TTL.
  - `fetchMentions` (currently at ~line 1377): stop calling `fetchIssueComments(apiKey, issue.id)`. Use the `comments` field embedded on the `LinearIssue` returned by `fetchMentionScanIssues`. Continue to call `addReactionToComment` per matched comment.
- `apps/agent/src/agent/linear.ts`
  - Extend `LinearIssue` (or a narrower `LinearMentionScanIssue`) to optionally carry `comments: Array<{ id; body; createdAt; user: { id; name? } }>`.
  - Update the `fetchMentionScanIssues` GraphQL query to select `comments(first: 50) { nodes { id body createdAt user { id name } } }`. Map nodes into the new field.
- `apps/agent/src/list.ts`
  - Replace the per-row `fetchIssueAttachments` + `findPullRequestUrl` in the parallel resolver (lines ~273–282) with the shared GitHub-first resolver. Keep the parallel `Promise.all` shape; fallback path may still hit Linear attachments per row when GitHub yields nothing.
- `apps/agent/src/pr-status.ts`
  - When a tracked PR transitions to a new state, invalidate the matching `prUrlByIssue` entry via a callback passed in from `wire.ts`/coordinator. The invalidator is a small `(issueId) => void` injected at construction; no new module-level state.
- Tests
  - `apps/agent/src/agent/__tests__/wire.mention-scan.test.ts` — assert zero `fetchIssueComments` calls when comments are present in candidates.
  - `apps/agent/src/agent/__tests__/wire.pr-url.test.ts` (new) — exercises:
    - GitHub returns an open PR matching by title → used; Linear never called.
    - GitHub returns multiple closed PRs → most recently updated picked; Linear never called.
    - GitHub returns a match by `headRefName` containing the slugged identifier → used.
    - GitHub returns nothing → falls back to Linear attachments.
    - Second call within 5 minutes hits the cache (no resolver invocation).
    - Cache TTL expires after 5 minutes → resolver re-invoked.
    - PR-status transition invalidates the cache entry → next call re-resolves.

## Data flow (new mention-scan path)

```
poll tick
  → fetchMentionScanIssues   (single GraphQL query, now includes comments)
  → for each candidate
       inline comments → mention matcher
       on match → addReactionToComment  (per-match, rare)
       if wantCodeReview → resolvePrUrlForIssue → GitHub-first → cache
```

## Data flow (new PR-URL resolution)

```
resolvePrUrlForIssue(issue)
  ├── prUrlByIssue.get(issue.id) within TTL → return cached
  ├── discoverPrUrlFromGitHub(issue)
  │     gh pr list --search "<identifier> in:title" --state all --json url,state,headRefName,title
  │     pick: prefer state=OPEN, else most recently updated; also accept
  │           any row where headRefName.includes(slug(identifier))
  ├── if nothing → discoverPrUrlFromLinear(issue)
  └── cache result (incl. null) with fetchedAt=Date.now()
```

## Cache semantics

- Key: `LinearIssue.id` (stable across polls).
- Value: `{ url: string | null; fetchedAt: number }`. Negative results are cached too — that's where most of the savings come from when an issue has no PR yet.
- TTL: 5 minutes (`PR_URL_CACHE_TTL_MS = 5 * 60 * 1000`).
- Invalidation triggers:
  1. TTL expiry (lazy check on read).
  2. Explicit `invalidate(issueId)` call from `pr-status.ts` when a tracked PR transitions state.
- Owned by the `wire.ts` closure (same scope as `prByChange`/`prUnavailable`). No separate module; keeps the lifetime tied to the poll loop.

## Edge cases

- **`gh` not installed / not authed.** `discoverPrUrlFromGitHub` logs once and returns `null`; Linear fallback handles it. Same pattern as existing `gh` usage in `wire.ts`.
- **Multiple PRs with the same identifier in title.** Prefer OPEN; if none open, pick the most recently updated CLOSED/MERGED. If still tied, take the first row — deterministic.
- **`headRefName` match for the wrong issue.** Slugged identifier check uses the full lowercased `identifier` (e.g. `rlf-66`) as a word-ish substring of the head ref. Linear identifiers are already unique within a team, so collisions across teams are not in scope.
- **Comments field exceeds 50.** Mention scan only cares about comments newer than the last Ralph pickup; older history is irrelevant. The current code also reads via `fetchIssueComments` which paginates differently — empirically the recent 50 covers every relevant case. Document as a known limitation.
- **Cache memory growth.** Bounded by candidate count per poll; entries naturally expire by TTL. No explicit cap needed for now.
- **PR-status invalidation race.** If a state transition fires while `resolvePrUrlForIssue` is in flight, the next call after settle will see a stale cached entry only until the next TTL window. Acceptable — the URL itself rarely changes when state changes, only the state does.
