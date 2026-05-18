# linear-mention-scan — handle rate-limit signals

## ADDED Requirements

### Requirement: Linear requests MUST treat 429 and `Rate limit exceeded` bodies as rate-limited

The `linearRequest` helper in `apps/agent/src/agent/linear.ts` MUST tag the
thrown error with `rateLimited = true` and abort retry whenever the HTTP
response status is `429` **or** the response body (case-insensitive) contains
the substring `Rate limit exceeded`. Rate-limited errors MUST NOT be retried
inside `linearRequest`; they MUST bubble up to the caller immediately.

The module MUST export an `isRateLimitedError(err)` predicate that returns
`true` only for errors carrying the `rateLimited = true` tag.

`formatLinearError` MUST prepend `rate limited` and omit the long response body
when the error is rate-limited, so log lines stay short.

#### Scenario: HTTP 429 marks the error rate-limited

- **Given** a Linear API endpoint that returns HTTP 429 with any body
- **When** `linearRequest` is invoked against it
- **Then** the thrown error has `rateLimited === true`
- **And** `formatLinearError(err)` includes the phrase `rate limited`

#### Scenario: HTTP 400 with rate-limit body marks the error rate-limited

- **Given** a Linear API endpoint that returns HTTP 400 with a body containing
  the phrase `Rate limit exceeded`
- **When** `linearRequest` is invoked against it
- **Then** the thrown error has `rateLimited === true`

#### Scenario: plain HTTP 400 is not rate-limited

- **Given** a Linear API endpoint that returns HTTP 400 with a body that does
  not contain the phrase `Rate limit exceeded`
- **When** `linearRequest` is invoked against it
- **Then** the thrown error has `rateLimited` falsy (undefined/false)

### Requirement: Mention scan MUST abort cleanly on rate-limit signals

The `fetchMentions` function in `apps/agent/src/agent/wire.ts` MUST short-circuit
on the first rate-limited Linear error and MUST log a single yellow line of the
form `! mention scan: rate limited, deferring rest of scan to next poll`.

- If `fetchMentionScanIssues` itself throws a rate-limited error, `fetchMentions`
  MUST return `[]` after logging.
- If a per-candidate Linear call (`fetchIssueComments`,
  `addReactionToComment`) throws a rate-limited error, `fetchMentions` MUST
  stop processing remaining candidates and MUST return the mentions already
  collected.
- The rate-limit log line MUST only be emitted once per scan, even if multiple
  candidates would have triggered it.

#### Scenario: candidate fetch hits rate limit mid-scan

- **Given** three candidate issues and `fetchIssueComments` throws a
  rate-limited error on the second one
- **When** `fetchMentions` runs the scan
- **Then** `fetchIssueComments` is invoked for the first and second candidates
  only
- **And** the third candidate is never queried
- **And** the scan returns only the mentions collected from the first candidate
- **And** exactly one yellow `! mention scan: rate limited, deferring rest of
scan to next poll` line is logged
