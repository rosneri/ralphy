# Design for RLF-65

## Files to touch

- `apps/agent/src/agent/linear.ts` — detect rate-limit (status or body), tag
  errors, expose `isRateLimitedError`, update `formatLinearError`.
- `apps/agent/src/agent/wire.ts` — short-circuit `fetchMentions` on rate-limit.
- `apps/agent/src/__tests__/linear.test.ts` — cover the new detection paths and
  formatter behaviour.
- `apps/agent/src/__tests__/mention-reaction.test.ts` — cover the scan-abort
  behaviour end-to-end.

## Data flow

`linearRequest` already handles transient HTTP errors with bounded retries. We
extend the failure branch so that **before** the retry decision, the request
checks whether the response is a rate-limit signal:

- `res.status === 429`, **or**
- `isRateLimitedBody(body)` — case-insensitive substring match for
  `Rate limit exceeded`.

If either is true, the error gets `rateLimited = true` and is thrown immediately
(no retry). `isRetryableStatus` no longer includes 429, so it can't accidentally
be retried via the 5xx path. `isRateLimitedError(err)` is the single predicate
callers use.

`fetchMentions` wraps each Linear call with a `try`/`catch`. On a rate-limited
error:

- If the **initial** `fetchMentionScanIssues` call fails, the function logs once
  and returns `[]`.
- If a **per-candidate** call (`fetchIssueComments`, `addReactionToComment`)
  fails, the function logs once (idempotent via a local `rateLimitedLogged`
  flag), then `break`s out of the candidate loop and returns the mentions
  collected so far. The `addReactionToComment` path also marks the issue as
  queued so the same comment is not picked up again next tick.

## Edge cases

- **Non-string bodies**: `isRateLimitedBody` defends against non-string `body`
  values (returns `false`).
- **Empty body**: returns `false` — only positive matches mark rate-limit.
- **Concurrent reaction errors**: multiple comments hitting the rate limit in
  the same scan log only once because of `rateLimitedLogged`.
- **`formatLinearError` for non-rate-limit errors**: behaviour unchanged — the
  `rateLimited` branch only adds the prefix when the tag is set.
- **400 without the phrase**: still surfaces as a normal Linear error, not
  rate-limited.

## Non-goals

- No retry/backoff for rate-limit. Linear's signal is "stop", so we stop and
  let the next scheduled poll try again.
- No global circuit breaker across other Linear surfaces (issues list, PR
  status). Out of scope for this change.
- No telemetry/metric for rate-limit occurrences (could be added later).
