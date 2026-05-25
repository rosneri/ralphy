# RLF-149: Mergability unknown

Source: [RLF-149](https://linear.app/neriros/issue/RLF-149/mergability-unknown)
Status: In Progress
Assignee: Neriya Rosner
Labels: Bug, ralph:approved

## Why

GitHub's REST API does not compute PR mergeability synchronously. When `gh pr view`
is called shortly after a push, the `mergeable` field returns `"UNKNOWN"` while
GitHub calculates the merge state in the background. Additionally, transient
network errors (HTTP 502 from GitHub's API) caused the retry loop in the PR
scanner to abort immediately instead of continuing to retry — masking the actual
retry behaviour and leaving the PR stuck as `"unknown"` for the entire poll interval.

Two specific failure modes were reported:

1. `gh: HTTP 502` during a `gh pr view` call aborted the 3-attempt retry loop on
   the first attempt, so no retries actually ran.
2. After a conflict-fix rebase+push, a single `fetchPrStatus` call was made with
   no retry — GitHub's freshly-pushed commit often returns `UNKNOWN` for several
   seconds, causing the conflict label to be left in place unnecessarily.

## What Changes

- **`pr-discovery.ts`**: Errors inside the mergeability-retry loop (e.g. HTTP 502)
  now fall through to the next retry attempt instead of returning `"unknown"`
  immediately. After exhausting all 3 attempts the original `"unknown"` result is
  still returned, so the coordinator rechecks on the next poll as before.
- **`post-task.ts`**: The conflict-fix verify path now retries `fetchPrStatus` up to
  3 times (2 s delay, configurable to 0 in tests) when mergeability is `UNKNOWN`
  before giving up and leaving the conflict label in place.
- **Tests**: `post-task-conflict-fix.test.ts` gains two new test cases — one
  verifying that persistent `UNKNOWN` triggers exactly 4 `gh pr view` calls (1 + 3
  retries) and one verifying that `UNKNOWN → MERGEABLE` after retries clears the
  conflict label without a full re-poll cycle. The mock helper is extended to
  support per-call response sequences.

## Linear comments

**Neriya Rosner** — 2026-05-23T07:28:58.355Z

<!-- ralphy:tasks:start -->

### Ralph progress

_No mission tasks yet — planning in progress._

<sub>`rlf-149-mergability-unknown` · iteration 0</sub>

<!-- ralphy:tasks:end -->

**Neriya Rosner** — 2026-05-23T07:28:58.172Z
🤖 Ralph started working on this issue. Tracking change: `rlf-149-mergability-unknown`

## Additional instructions

You are working on RLF-149: Mergability unknown.

Labels: Bug, ralph:approved

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
