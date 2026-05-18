# Tasks for RLF-66

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-66/cut-linear-rate-limit-pressure-github-first-pr-lookup-batched-mention and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Extend `fetchMentionScanIssues` in `apps/agent/src/agent/linear.ts` to select `comments(first: 50) { nodes { id body createdAt user { id name } } }` and expose those comments on each returned candidate (add an optional `comments` field to the candidate type used by the mention scan)
- [x] Add `discoverPrUrlFromGitHub(issue)` in `apps/agent/src/agent/wire.ts` that runs `gh pr list --search "<identifier> in:title" --state all --json url,state,headRefName,title`, accepts both title and `headRefName`-contains-slug matches, prefers OPEN over non-open, and tie-breaks by most-recently-updated
- [x] Update the shared PR-URL resolver (`resolvePrUrlForIssue` and `discoverPrUrl` in `wire.ts`) to call `discoverPrUrlFromGitHub` first and only fall back to `discoverPrUrlFromLinear` when GitHub returns no match
- [x] Update `apps/agent/src/list.ts` PR-URL resolution (around the `fetchIssueAttachments` loop near line 276) to use the GitHub-first path, falling back to Linear attachments only when GitHub yields nothing
- [x] Modify `fetchMentions` in `apps/agent/src/agent/wire.ts` to consume inline candidate comments and stop calling `fetchIssueComments(apiKey, issue.id)`; keep per-match `addReactionToComment` calls intact
- [x] Add a `Map<issueId, { url: string | null; fetchedAt: number }>` PR-URL cache (TTL = 5 minutes) inside the `wire.ts` closure and route `resolvePrUrlForIssue` through it; cache negative results too
- [x] Expose an `invalidate(issueId)` hook on the cache and wire `apps/agent/src/pr-status.ts` to call it on tracked-PR state transitions
- [x] Add unit tests covering: GitHub-first happy path (no Linear call), `headRefName` slug match, OPEN-preferred / most-recently-updated tie-break, Linear-attachment fallback when GitHub returns nothing
- [x] Add unit tests for the inline-comments mention scan: zero `fetchIssueComments` calls when no new mentions, reaction still fires once per matched comment
- [x] Add unit tests for the per-issue PR-URL cache: hit within TTL, miss after TTL, explicit invalidate, cached negative results
- [x] Run `bunx openspec validate rlf-66-cut-linear-rate-limit-pressure-github-fi --strict`
- [x] Run `bun run lint`
- [x] Run `bun run test`
