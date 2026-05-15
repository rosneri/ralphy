# RLF-13: Show PR status (conflicts, CI failures) in `agent list`

Source: [RLF-13](https://linear.app/neriros/issue/RLF-13/show-pr-status-conflicts-ci-failures-in-agent-list)
Status: In Progress
Labels: ralph:auto-merge

## Problem

`agent list` currently shows a Linear-ticket-per-bucket view with a PR URL column but no health
information. To triage which of N in-flight agents needs attention, users must click each PR URL
in GitHub to find conflicts or red CI. That is slow when juggling several agents and obscures the
fact that some PRs are blocking the auto-merge queue.

## Approach

Augment the Linear-tickets section of `agent list` (in `apps/agent/src/list.ts`) with a per-PR
status column populated by a single `gh pr view <url> --json ...` call per PR. The same call
returns state, draft flag, mergeable, statusCheckRollup, autoMergeRequest, and createdAt — enough
to compute conflict / CI / auto-merge / age in one shot.

Replace the current per-bucket printing with a single unified table that is re-sorted across all
fetched issues by the prioritization tiers in the issue. Within each tier, oldest PR first.

PR status is rendered as short markers (`✗conflict`, `✗ci`, `⏳ci`, `draft`, `auto-merge`, `merged`,
`closed`) so they are visually obvious without breaking the existing plain-text table layout.
PRs without a remote (no URL found in Linear attachments) still render as `(no PR)` and sort into
tier 5.

`gh` failures (no auth, network) degrade gracefully: the per-PR status cell shows `?` and the row
sorts into tier 5; the rest of the list is still printed.

## Acceptance criteria

- [x] `agent list` shows a per-agent PR status column populated from `gh pr view`.
- [x] Conflicted PRs are visually flagged (`✗conflict`).
- [x] Failing CI checks are visually flagged (`✗ci`); pending shown as `⏳ci`.
- [x] PRs without a remote degrade gracefully (`(no PR)`, no `gh` call attempted).
- [x] Rows are sorted by tiers: conflicted+auto-merge → ci-failing+auto-merge → conflicted →
      ci-failing → other; within each tier oldest-first by PR `createdAt`.
- [x] `bun run lint` and `bun run test` pass with new tests covering the sort and status mapping.

## Out of scope

- Adding PR status to the local-tasks table (those rows do not carry a PR URL today).
- Caching `gh` responses across invocations — `agent list` is interactive and one-shot.
- Surfacing individual failing check names — we only show the rolled-up bucket.

## Steering

_Add steering notes here as the loop runs._
