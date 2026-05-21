# shared-capabilities — comment indicator marker

## ADDED Requirements

### Requirement: Marker union MUST include a comment variant

The `Marker` type exported from `@ralphy/types` MUST include a variant
`{ type: "comment"; value: string }` in addition to the existing
`label`, `status`, `attachment`, and `project` variants. The `value`
field is the literal substring that callers want matched inside an
issue's comment bodies.

#### Scenario: type system accepts a comment marker

- **Given** a caller constructs `{ type: "comment", value: "ralph go" }`
- **When** that value is assigned to a `Marker`
- **Then** the TypeScript compiler accepts it without an error
- **And** every exhaustive marker switch in the codebase handles the
  new variant (either with explicit behaviour or an explicit no-op).

### Requirement: issueMatchesGetIndicator MUST honour comment markers

`issueMatchesGetIndicator(issue, indicator)` MUST return `true` when the indicator's filter contains a `comment` marker AND at least one entry in `issue.comments` satisfies BOTH:

1. The comment body, lower-cased, contains the marker's `value` lower-cased
   as a substring; AND
2. The comment is NOT a Ralph-authored comment per the existing
   `isRalphComment(body)` predicate.

When `issue.comments` is `undefined` or empty, a `comment` marker MUST
contribute `false` to the any-of result rather than throwing.

#### Scenario: matching non-Ralph comment causes pickup

- **Given** an indicator with filter `[{ type: "comment", value: "ralph go" }]`
- **And** an issue with one comment `"please RALPH GO when ready"` authored
  by a non-Ralph user
- **When** `issueMatchesGetIndicator` is called
- **Then** it returns `true`

#### Scenario: Ralph-authored comments do not match

- **Given** an indicator with filter `[{ type: "comment", value: "go" }]`
- **And** an issue whose only matching comment body starts with
  `"🤖 Ralph picked this up, going now"` (matched by `isRalphComment`)
- **When** `issueMatchesGetIndicator` is called
- **Then** it returns `false`

#### Scenario: missing comments slice is treated as no-match

- **Given** an indicator with filter `[{ type: "comment", value: "go" }]`
- **And** an issue object whose `comments` property is `undefined`
- **When** `issueMatchesGetIndicator` is called
- **Then** it returns `false` and does not throw

### Requirement: GraphQL issue fetch MUST include comments when a comment marker is configured

The Linear issue-fetch path used by `getX` evaluation MUST include the `comments` connection (id, body, createdAt, user) in its GraphQL selection set whenever the resolved `Indicators` map contains any `comment` marker in any active `getX` filter. When no `comment` marker is
configured, the fetch path MUST omit the comments slice to avoid
unnecessary API cost.

#### Scenario: comments slice is fetched when configured

- **Given** `getTodo.filter` contains a `comment` marker
- **When** the coordinator's poll triggers an issue fetch
- **Then** the GraphQL query includes the `comments` selection set
- **And** matching issues are surfaced by `issueMatchesGetIndicator`

### Requirement: comment markers MUST NOT be allowed in SetIndicator slots

Config loading MUST reject any `SetIndicator` slot (`setInProgress`,
`setDone`, `setError`, `setConflicted`, `clearConflicted`,
`clearReview`, `clearApproved`) that contains a marker with
`type === "comment"`. The rejection MUST happen at config load time, by
throwing an error whose message names the offending slot. Empty `value`
strings on a `comment` marker in any slot (get or set) MUST also be
rejected at load time.

#### Scenario: setDone with comment marker fails fast

- **Given** a config that sets `setDone: { type: "comment", value: "done" }`
- **When** the config is loaded
- **Then** loading throws an error whose message contains `setDone` and
  identifies `comment` markers as read-only

#### Scenario: empty comment value is rejected

- **Given** a config with `getTodo.filter: [{ type: "comment", value: "" }]`
- **When** the config is loaded
- **Then** loading throws an error identifying the empty `comment` value

### Requirement: describeIndicators MUST print comment markers

`describeIndicators` in `packages/types/src/types.ts` MUST render a
`comment` marker as `comment:<value>` inside the bracketed marker list
for each `getX` slot, matching the existing format for other marker
types.

#### Scenario: configured comment marker appears in describe output

- **Given** `getTodo.filter: [{ type: "comment", value: "ralph go" }]`
- **When** `describeIndicators` is called
- **Then** the returned string contains `todo=[comment:ralph go]`
