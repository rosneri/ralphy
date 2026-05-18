# Tasks for RLF-65

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-65/rate-limit-reached and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] In `apps/agent/src/agent/linear.ts`, add an `isRateLimitedBody(body)` helper (case-insensitive substring match for `Rate limit exceeded`).
- [x] In `linearRequest`, set `err.rateLimited = true` when the HTTP status is `429` **or** when `isRateLimitedBody(err.body)` returns true. Do not add a retry path for rate-limit errors — bubble them straight up.
- [x] Drop `429` from `isRetryableStatus` so rate-limit errors cannot accidentally be retried through the 5xx path.
- [x] Export `isRateLimitedError(err: unknown): boolean` from `apps/agent/src/agent/linear.ts` for callers.
- [x] Update `formatLinearError` to prepend `rate limited` (and elide the long body) when the error is rate-limited.
- [x] In `apps/agent/src/agent/wire.ts` `fetchMentions`, when the initial `fetchMentionScanIssues` throws a rate-limited error: log a single yellow `! mention scan: rate limited, deferring rest of scan to next poll` and `return []`.
- [x] In the same function, when any per-candidate Linear call (`fetchIssueComments`, `addReactionToComment`, etc.) throws a rate-limited error: log the same yellow line once and `break` out of the candidate loop, returning the mentions already collected.
- [x] Add tests in `apps/agent/src/__tests__/linear.test.ts` covering: a 429 marks `rateLimited`; a 400 with `Rate limit exceeded` body marks `rateLimited`; a plain 400 does not; `formatLinearError` includes `rate limited` for rate-limited errors.
- [x] Add a test in `apps/agent/src/__tests__/mention-reaction.test.ts` verifying that when one candidate's `fetchIssueComments` throws a rate-limited error, the scan stops calling `fetchIssueComments` for remaining candidates and returns the mentions seen so far.
- [x] Run `bunx openspec validate rlf-65-rate-limit-reached` and resolve any errors.
- [x] Run `bun run lint` and `bun run test`; fix any failures introduced by the change.
- [x] Stage each modified file individually and commit with a message of the form `rlf-65: detect rate-limit from body, abort mention scan early` (no `git add -A`).

## Manual Testing

> Verified by code inspection of `apps/agent/src/agent/linear.ts` and
> `apps/agent/src/agent/wire.ts`, plus the dedicated tests in
> `apps/agent/src/__tests__/linear.test.ts` (`rate-limit detection (RLF-65)`
> block at line 189) and `apps/agent/src/__tests__/mention-reaction.test.ts`
> (`rate-limit on fetchIssueComments stops the scan early (RLF-65)` at
> line 263). A live Linear account hammering the API at rate-limit was not
> available in this environment, so the items below are validated against the
> mocked-fetch tests and the rendered code paths.

- [x] Simulate a Linear `HTTP 429` response and confirm `linearRequest` throws an error with `rateLimited === true` and never retries. — `linear.ts:370–372` tags `err.rateLimited = true` and throws immediately on `res.status === 429`, before the `isRetryableStatus` branch; `isRetryableStatus` (line 278–280) no longer includes 429, so the retry path cannot fire. Covered by `linear.test.ts:207` (`a 429 marks the error as rateLimited and is not retried`).
- [x] Simulate a Linear `HTTP 400` whose body contains `Rate limit exceeded` and confirm the thrown error is still tagged `rateLimited === true`. — `linear.ts:370` ORs `isRateLimitedBody(err.body)` (defined at lines 305–308 with case-insensitive substring match) into the tag. Covered by `linear.test.ts:215` (`a 400 with 'Rate limit exceeded' body marks rateLimited`).
- [x] Simulate a plain `HTTP 400` with an unrelated body and confirm the error is **not** rate-limited. — `isRateLimitedBody` returns false for any string without `rate limit exceeded`; `linear.ts:374` then falls through to the normal `lastHttpError` path. Covered by `linear.test.ts:225` (`a plain 400 is NOT marked rateLimited`).
- [x] Call `formatLinearError({ status: 429, body: "…", rateLimited: true })` and confirm the output starts with `rate limited` and does not include the body text. — `linear.ts:332` pushes `rate limited` as the first part; `linear.ts:337` skips appending the body when `e.rateLimited` is truthy. Covered by `linear.test.ts:233`.
- [x] Trigger the mention scan when `fetchMentionScanIssues` throws a rate-limited error and confirm the agent logs **one** yellow `! mention scan: rate limited, deferring rest of scan to next poll` and returns no mentions. — `wire.ts:1362–1369`: the initial `try` catches the throw, `isRateLimitedError(err)` short-circuits to a single `onLog(..., "yellow")` and `return []` before any candidates are touched.
- [x] Trigger the mention scan with three candidates where the second candidate's `fetchIssueComments` throws a rate-limited error; confirm only the first two candidates are queried and the third is skipped, and the log line appears exactly once. — `wire.ts:1378–1392`: the candidate loop catches the per-issue error; `isRateLimitedError(err)` calls `logRateLimited()` (idempotent via `rateLimitedLogged` flag at line 1372) and `break`s the loop, so remaining candidates are never iterated. Mention rows already pushed to `out` for earlier candidates are still returned. Covered end-to-end by `mention-reaction.test.ts:263` (`rate-limit on fetchIssueComments stops the scan early (RLF-65)`), which asserts only two `fetchIssueComments` calls fire and the log line is present.
- [x] Trigger a rate-limited error from `addReactionToComment` mid-scan and confirm the issue is still marked `queued` (so the same comment is not re-picked next tick), the log line is emitted once, and the candidate loop breaks. — `wire.ts:1412–1417`: the inner `try` around `addReactionToComment` calls `logRateLimited()`, adds the issue to `queued`, then breaks the inner comment loop. The outer `if (rateLimitedLogged) break;` guard at `wire.ts:1426` then breaks the candidate loop so no further Linear calls fire.
- [x] After a rate-limited scan, run the next poll tick and confirm the scan retries from scratch (no persistent rate-limited state across `fetchMentions` calls). — `rateLimitedLogged` and `queued` are local variables declared inside `fetchMentions` (`wire.ts:1371–1372`), so each invocation starts with a clean slate; there is no module-level rate-limit cache to clear.
