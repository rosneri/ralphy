# RLF-80: Comment indicator

Source: [RLF-80](https://linear.app/neriros/issue/RLF-80/comment-indicator)
Status: Done
Assignee: Neriya Rosner

## Why

Today the indicator framework recognises four `Marker` kinds — `label`,
`status`, `attachment`, `project` — and a separate, ad-hoc mention-scan
path looks for the configured `mentionHandle` text inside Linear / GitHub
comments. The mention path proves the value of text-on-a-comment as a
trigger, but the rest of the lifecycle (`getTodo`, `getInProgress`,
`getReview`, …) can't use the same signal because the indicator
filter has no `comment` marker. Users who want to gate pickup on a
specific phrase in the discussion (e.g. "ralph go", "needs-ralph",
or a reviewer leaving a stock approval line) have no first-class way
to express that today.

## What Changes

- Add a new `Marker` variant `{ type: "comment"; value: string }` to
  `@ralphy/types` and update every exhaustive marker switch (notably
  `markersToFilters` in `linear-client.ts` — `comment` is filter-only and
  contributes nothing to label/status/project query filters).
- Extend `issueMatchesGetIndicator` so a `comment` marker matches when at
  least one non-Ralph comment on the issue contains `value`
  case-insensitively (substring match).
- Have the Linear issue-fetch path used by `getX` evaluation include the
  `comments` connection when any active indicator carries a `comment`
  marker, so the matcher has the data it needs.
- Reject `comment` in any `SetIndicator` slot (`setDone`, `setInProgress`,
  …) at config load time: comments are read-only signals, not state
  Ralph mutates.
- Update CLI marker parsing / `describeIndicators` so users can
  configure it via existing flags and see it printed back.

## Acceptance criteria

- `getTodo.filter` accepts a `{ type: "comment", value: "ralph go" }`
  marker and picks up an issue when any non-Ralph comment body contains
  that phrase (case-insensitive).
- Issues whose only matching comment was authored by Ralph itself (per
  the existing `isRalphComment` check) MUST NOT match.
- `setDone: { type: "comment", value: "..." }` fails fast at config load
  with an error that names the bad slot.
- `bun run lint` and `bun run test` pass.

## Additional instructions

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
