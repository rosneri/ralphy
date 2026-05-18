# linear-rate-limit-relief — cut per-poll Linear traffic

## ADDED Requirements

### Requirement: PR-URL resolution MUST consult GitHub before Linear attachments

`apps/agent/src/agent/wire.ts` MUST provide a `discoverPrUrlFromGitHub(issue)` helper that runs
`gh pr list --search "<issue.identifier> in:title" --state all --json url,state,headRefName,title`
and returns at most one PR URL. The helper MUST also accept a match where the row's `headRefName`
contains the lowercased issue identifier (Ralph branches embed the identifier).

When multiple rows match, the helper MUST prefer rows with `state = "OPEN"` over any non-open
state, and within the same state bucket MUST pick the most recently updated row.

The shared resolver used by the mention scan, the conflict scan (`fetchDoneCandidates`), and
`apps/agent/src/list.ts` MUST consult `discoverPrUrlFromGitHub` first and MUST only call
`discoverPrUrlFromLinear` (which invokes `fetchIssueAttachments`) when GitHub returns no match.

#### Scenario: GitHub returns an open PR — Linear attachments are never queried

- **Given** an issue with identifier `RLF-123` and a candidate set passed to `fetchMentions`
- **And** `gh pr list --search "RLF-123 in:title" --state all` returns one row with `state = "OPEN"`
- **When** the shared PR-URL resolver runs for that issue
- **Then** the resolver returns the GitHub row's `url`
- **And** `fetchIssueAttachments` is not called for that issue

#### Scenario: GitHub matches by branch name

- **Given** an issue with identifier `RLF-123`
- **And** `gh pr list` returns a row whose `title` does not contain `RLF-123` but whose
  `headRefName` is `ralph/rlf-123-some-change`
- **When** the resolver runs
- **Then** the row is accepted and its `url` is returned

#### Scenario: GitHub returns multiple PRs — prefer open, then most recently updated

- **Given** `gh pr list` returns two rows for the same identifier: one `OPEN` updated yesterday
  and one `MERGED` updated an hour ago
- **When** the resolver runs
- **Then** the resolver returns the `OPEN` row's `url`

#### Scenario: GitHub returns nothing — fall back to Linear attachments

- **Given** `gh pr list` returns an empty array for the identifier
- **When** the resolver runs
- **Then** `discoverPrUrlFromLinear` is invoked
- **And** `fetchIssueAttachments` is called exactly once for that issue

### Requirement: Mention scan MUST read comments from the candidate query, not a per-issue fetch

`fetchMentionScanIssues` in `apps/agent/src/agent/linear.ts` MUST include
`comments(first: 50) { nodes { id body createdAt user { id name } } }` in its GraphQL selection
and MUST expose those comments on each returned candidate.

`fetchMentions` in `apps/agent/src/agent/wire.ts` MUST consume the inline comments and MUST NOT
call `fetchIssueComments(apiKey, issue.id)` during the mention scan.

The existing per-match reaction flow MUST be preserved: `addReactionToComment` is still called
once per matched comment.

#### Scenario: zero new mentions → zero per-issue comment fetches

- **Given** a mention scan over 20 candidate issues, each with comments embedded in the
  candidate query result
- **And** no comment matches the configured `@<handle>` since the last Ralph pickup
- **When** `fetchMentions` completes
- **Then** `fetchIssueComments` is called zero times
- **And** the scan returns an empty mention list

#### Scenario: a match still reacts via the existing per-comment endpoint

- **Given** a candidate issue whose inline comments contain one matching `@ralphy` mention
- **When** `fetchMentions` processes it
- **Then** the mention is included in the return value
- **And** `addReactionToComment` is invoked exactly once with that comment's id

### Requirement: PR-URL resolution MUST cache per-issue results with a 5-minute TTL

`resolvePrUrlForIssue` in `apps/agent/src/agent/wire.ts` MUST maintain a per-issue cache keyed by
`LinearIssue.id` with values of shape `{ url: string | null; fetchedAt: number }` and a TTL of
5 minutes. Negative results (`url === null`) MUST be cached using the same TTL.

The cache MUST expose an `invalidate(issueId)` operation. `apps/agent/src/pr-status.ts` MUST call
`invalidate(issueId)` whenever a tracked PR for that issue transitions state.

#### Scenario: second call within 5 minutes hits the cache

- **Given** `resolvePrUrlForIssue` has just returned a URL for issue `RLF-123`
- **When** `resolvePrUrlForIssue` is called again for `RLF-123` 30 seconds later
- **Then** neither `discoverPrUrlFromGitHub` nor `discoverPrUrlFromLinear` is invoked
- **And** the previously returned URL is returned

#### Scenario: cache entry expires after 5 minutes

- **Given** a cached entry for issue `RLF-123` with `fetchedAt` six minutes in the past
- **When** `resolvePrUrlForIssue` is called for `RLF-123`
- **Then** `discoverPrUrlFromGitHub` is invoked again

#### Scenario: PR state transition invalidates the cache

- **Given** a cached URL for issue `RLF-123`
- **When** `pr-status.ts` observes a state transition on the tracked PR for `RLF-123`
- **And** `resolvePrUrlForIssue` is called for `RLF-123` immediately after
- **Then** `discoverPrUrlFromGitHub` is invoked again

#### Scenario: negative results are cached too

- **Given** `resolvePrUrlForIssue` returns `null` for issue `RLF-123` because neither GitHub nor
  Linear has a PR
- **When** `resolvePrUrlForIssue` is called again for `RLF-123` 30 seconds later
- **Then** no resolver is invoked
- **And** the call returns `null`
