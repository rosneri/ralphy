# RLF-36: Apply FIFO age sorting within each agent queue bucket

Source: [RLF-36](https://linear.app/neriros/issue/RLF-36/apply-fifo-age-sorting-within-each-agent-queue-bucket)
Status: In Progress

## Problem

Agent mode currently ranks queued work by (auto-merge unblock, Linear priority, spawn-mode). Within each bucket, ties fall back to insertion order — which is the Linear fan-out order from the latest poll. That order is undefined for ties, so an issue can starve indefinitely if newer issues keep slotting next to it. The unified `ralph list` output has the same blind spot: the secondary sort key is PR-creation time (only populated when there is a PR) and a coarse `bucketOrder` fallback for no-PR rows.

## Approach

Carry Linear's `createdAt` timestamp through `LinearIssue` and use it as an additional sort key (ascending — oldest first) within each existing bucket:

- `apps/agent/src/agent/coordinator.ts` — after the existing `(autoMerge unblock → priority → mode rank)` comparison, break ties by `issue.createdAt` ascending.
- `apps/agent/src/list-sort.ts` — extend `SortableRow` with `issueCreatedAt` and order rows within a tier by issue age (then PR createdAt, then bucketOrder, then identifier) so the table reflects the coordinator's view.
- `apps/agent/src/agent/linear.ts` — request `createdAt` in the issue GraphQL query and surface it on `LinearIssue`.

## Acceptance Criteria

- Within the coordinator's queue, equal-priority items in the same spawn-mode bucket spawn oldest-first.
- Within a tier in `ralph list`, equal-tier rows are displayed oldest-issue-first.
- All existing sort behavior (auto-merge bump, priority order, conflict tiering) is preserved.
- Coverage threshold is not reduced; new tests cover the FIFO ordering for both code paths.

## Steering

_Add steering notes here as the loop runs._
