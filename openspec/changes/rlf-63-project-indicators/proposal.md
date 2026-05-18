# RLF-63: Project Indicators

Source: [RLF-63](https://linear.app/neriros/issue/RLF-63/project-indicators)
Status: In Progress
Assignee: Neriya Rosner

## Why

Today `linear.indicators` markers only support `label`, `status`, and
`attachment` types. Teams that organise work in Linear **Projects** (the
container that groups related issues) have no way to (a) restrict the
agent's pickup queue to a specific Linear project or (b) move an issue
into a project as a lifecycle signal. Adding a `project` marker type
completes the indicator lifecycle for project-organised teams and
unblocks scoping a Ralphy agent to a single Linear project without
needing per-issue labels.

## What Changes

- Add `project` as a fourth `Marker` `type` (alongside `label`, `status`,
  `attachment`) in `@ralphy/types`, mirrored in the Zod `MarkerSchema`
  used by `WORKFLOW.md` parsing.
- Extend the `LinearIssue` shape with `project: { id, name } | null` and
  request the field from Linear's GraphQL API.
- Teach `buildIssueFilter` to translate `project`-typed markers into a
  Linear `project: { name: { in: [...] } }` clause for both `include`
  (get-indicators) and `exclude`.
- Teach `issueMatchesGetIndicator` to match against the issue's project
  name (case-insensitive), so callers that only have the cached
  `LinearIssue` (e.g. auto-merge opt-in) can still decide.
- Add a `setIssueProject(apiKey, issueId, projectId)` mutation helper
  and a `fetchProjectIdByName(apiKey, name)` resolver so set-side
  indicators (`setInProgress`, `setDone`, etc.) can move an issue into
  a named project.
- Keep `clearConflicted` / `clearReview` label-only — extend the
  schema's `superRefine` to also reject `project` markers there.

## Acceptance Criteria

- `linear.indicators.*.filter` accepts `{ type: project, value: "<name>" }`
  entries and round-trips through `parseWorkflow` without error.
- A `getTodo` indicator filtered by project N picks up only issues whose
  Linear project name equals N (case-insensitive).
- A `setInProgress` indicator with a `project` marker moves the issue
  into the named project on lifecycle transition (idempotent if the
  issue is already there).
- `clearConflicted` / `clearReview` reject `project` markers at parse
  time with a clear message.
- `bun run lint` and `bun run test` pass.

## Description

add a linear project indicator, get and set

## Additional instructions

You are working on RLF-63: Project Indicators.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
