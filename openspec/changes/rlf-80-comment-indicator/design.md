# Design for RLF-80 — Comment indicator

## Files touched

- `packages/types/src/types.ts` — add `comment` to the `Marker` union.
- `apps/agent/src/shared/capabilities/linear-client.ts`
  - `markersToFilters` (~line 86): no-op for `comment` (no GraphQL
    pre-filter; the filter runs client-side post-fetch).
  - `issueMatchesGetIndicator` (~line 914): add a `comment` branch.
    Reuses `isRalphComment` from
    `apps/agent/src/agent/wire/task-bodies.ts` to skip Ralph-authored
    comments. Match is `body.toLowerCase().includes(value.toLowerCase())`.
  - The matcher's parameter type gains an optional `comments` slice;
    if it is missing while a `comment` marker is present, the matcher
    returns `false` for that marker (no false positives).
- Linear GraphQL fetcher(s) used by `getX` evaluation: include the
  `comments { nodes { id body createdAt user { name } } }` slice
  whenever the resolved indicator set contains any `comment` marker.
  Issues that don't need it keep the lighter query to limit API cost.
- Config loader (`apps/agent/src/agent/config.ts` / `cli.ts`): validate
  that no `SetIndicator` slot carries a `comment` marker; throw at load
  time with a message that names the offending slot.
- `apps/agent/test/harness/fake-linear.ts`: extend the fake so test
  issues can carry comments, and the harness honours `comment` markers
  end-to-end.

## Data flow

1. Config + CLI merge into `Indicators` via `mergeIndicators`.
2. Coordinator's `getX` evaluation calls into `linear-client` to fetch
   candidate issues. If any active `getX` filter contains a `comment`
   marker, the GraphQL query includes the comments slice.
3. `issueMatchesGetIndicator` is called per issue. The `comment` branch
   scans `issue.comments`, skips ones flagged by `isRalphComment`, and
   matches on case-insensitive substring.
4. Matched issues flow into the existing pickup / resume / review
   pipelines unchanged.

## Edge cases

- **Ralph's own comments**: skip via `isRalphComment` so the agent's
  own posts don't re-trigger pickup.
- **No comments fetched**: matcher returns `false` rather than throwing.
- **Empty `value`**: reject at config-load time; an empty substring
  would match every comment.
- **Set-side use**: reject at config-load time per acceptance criteria.
- **Cost**: fetching comments costs Linear API quota. Only enrich the
  query when a `comment` marker is actually configured.
- **GitHub PR comments**: out of scope; the indicator matches Linear
  comments only. The existing mention-scan path keeps its own GitHub
  branch.

## Test plan

- Unit: `issueMatchesGetIndicator` with a `comment` marker
  - matches when a non-Ralph comment contains the substring
  - skips Ralph-authored comments
  - returns `false` when `comments` slice is absent
  - case-insensitive substring match
- Config loader: `setDone: { type: "comment", value: "x" }` throws with
  a slot-naming error.
- Harness integration: a fake issue with a matching non-Ralph comment is
  picked up by a `getTodo` indicator configured with a `comment` marker;
  one whose only match is Ralph-authored is not.
- `describeIndicators` prints `comment:<value>` for configured markers.
