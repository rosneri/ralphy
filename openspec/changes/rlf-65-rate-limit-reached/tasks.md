# Tasks for RLF-65

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-65/rate-limit-reached and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [x]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `apps/agent/src/agent/linear.ts`, add an `isRateLimitedBody(body)` helper (case-insensitive substring match for `Rate limit exceeded`).
- [x] In `linearRequest`, set `err.rateLimited = true` when the HTTP status is `429` **or** when `isRateLimitedBody(err.body)` returns true. Do not add a retry path for rate-limit errors — bubble them straight up.
- [x] Export `isRateLimitedError(err: unknown): boolean` from `apps/agent/src/agent/linear.ts` for callers.
- [x] Update `formatLinearError` to prepend `rate limited` (and elide the long body) when the error is rate-limited.
- [x] In `apps/agent/src/agent/wire.ts` `fetchMentions`, when the initial `fetchMentionScanIssues` throws a rate-limited error: log a single yellow `! mention scan: rate limited, deferring rest of scan to next poll` and `return []`.
- [x] In the same function, when any per-candidate Linear call (`fetchIssueComments`, `addReactionToComment`, etc.) throws a rate-limited error: log the same yellow line once and `break` out of the candidate loop, returning the mentions already collected.
- [x] Add tests in `apps/agent/src/__tests__/linear.test.ts` covering: a 429 marks `rateLimited`; a 400 with `Rate limit exceeded` body marks `rateLimited`; a plain 400 does not; `formatLinearError` includes `rate limited` for rate-limited errors.
- [x] Add a test in `apps/agent/src/__tests__/mention-reaction.test.ts` (or `agent.test.ts`) verifying that when one candidate's `fetchIssueComments` throws a rate-limited error, the scan stops calling `fetchIssueComments` for remaining candidates and returns the mentions seen so far.
- [x] Run `bunx openspec validate rlf-65-rate-limit-reached` and resolve any errors.
- [x] Run `bun run lint` and `bun run test`; fix any failures introduced by the change.
- [x] Stage each modified file individually and commit with a message of the form `rlf-65: detect rate-limit from body, abort mention scan early` (no `git add -A`).
