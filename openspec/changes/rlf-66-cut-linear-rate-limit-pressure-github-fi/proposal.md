# RLF-66: Cut Linear rate-limit pressure: GitHub-first PR lookup, batched mention-scan comments, per-poll URL cache

Source: [RLF-66](https://linear.app/neriros/issue/RLF-66/cut-linear-rate-limit-pressure-github-first-pr-lookup-batched-mention)
Status: Done

## Why

Agent-mode polls hit Linear's GraphQL rate limit. The bulk `issues()` query is fine — the pressure comes from per-ticket loops fanned out behind it:

- ~50× `fetchIssueAttachments` per poll (one per candidate to discover the PR URL)
- ~50× `fetchIssueComments` per poll (one per candidate for the mention scan)
- Both repeat every poll even when nothing changed

That fan-out swamps the rate budget under realistic candidate counts. Three narrow changes remove the worst offenders without introducing a generic batching layer.

## What Changes

- **GitHub-first PR-URL resolution.** Add `discoverPrUrlFromGitHub(issue)` in `apps/agent/src/agent/wire.ts` that runs `gh pr list --search "<identifier> in:title" --state all --json url,state,headRefName,title` and also accepts a match where `headRefName` contains the slugged identifier. Prefer open over closed; tie-break by most recently updated. Only fall back to `discoverPrUrlFromLinear` (Linear attachments) when GitHub returns no match. Route all current callers — mention scan (`wire.ts` `fetchMentions`), conflict scan / `fetchDoneCandidates` (`wire.ts` `discoverPrUrl`), and `apps/agent/src/list.ts` PR-URL resolution — through the new GitHub-first path.
- **Batch comments into the mention-scan candidate query.** Extend the GraphQL selection inside `fetchMentionScanIssues` (`apps/agent/src/agent/linear.ts`) to also fetch `comments(first: 50) { nodes { id body user { id name } createdAt } }`. Drop the per-issue `fetchIssueComments(issue.id)` loop in `fetchMentions` and feed the inline comments straight to the mention matcher. Keep `addReactionToComment` per-comment (it only fires on actual matches, which are rare).
- **Per-poll PR-URL cache.** Introduce a `Map<issueId, { url: string | null; fetchedAt: number }>` with a 5-minute TTL keyed by Linear issue id (the existing `prByChange` keys by `changeName` and never expires). Expose it through `resolvePrUrlForIssue` in `wire.ts`. Invalidate the entry when a tracked PR transitions state (observed in `apps/agent/src/pr-status.ts`). With 1-minute polls and a 5-min TTL each ticket resolves once every 5 polls instead of every poll.

Out of scope (separate tickets): server-side `attachments(filter: { title: { eq: "Ralphy" } })` filter, batching blocker-attachment lookups in `resolveDependencyBaseBranch`, bulk-query refactor for `ralphy list`. Do not introduce a generic batching layer.

## Acceptance criteria

- During a poll with 20 candidate issues that already have GitHub PRs, `fetchIssueAttachments` is called zero times for PR-URL resolution.
- `fetchIssueComments` is called zero times during a mention scan that produces no new mentions.
- Repeated polls within 5 minutes do not re-resolve PR URLs for the same ticket.
- All existing mention-scan, conflict-scan, and code-review-trigger tests pass; new coverage exercises the GitHub-first path (including `headRefName` fallback and open-over-closed tie-break) and the cache TTL.

## Risk

Low. Each change is local, has a clear fallback, and is observable in the agent-mode log (`onLog`).

## Additional instructions

Project rules:

- use Bun-native APIs (`Bun.spawn` / `Bun.file`) — never `node:fs` sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: `dist/**`, `.claude/worktrees/**`.

## Steering

_Add steering notes here as the loop runs._
