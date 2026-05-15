# agent-queue-fifo — FIFO age sorting within agent queue buckets

## ADDED Requirements

### Requirement: agent coordinator MUST sort tied queue entries by issue createdAt ascending

When the `AgentCoordinator` orders its internal queue, items that compare equal under the existing keys (auto-merge unblock priority, Linear priority, spawn-mode rank) MUST be further ordered by the Linear issue's `createdAt` timestamp in ascending order. The existing top-level ranking (auto-merge first, then priority, then mode) MUST be preserved.

`LinearIssue` MUST carry a `createdAt: string` field populated from Linear's GraphQL `createdAt` field. The agent fetch MUST request this field on every issue query used for queue selection.

#### Scenario: ties within a priority/mode bucket spawn oldest first

- **Given** three fresh-mode issues at Linear priority 3 with `createdAt` values `2026-01-01`, `2026-03-01`, and `2026-05-10`
- **And** coordinator concurrency is 1
- **When** the coordinator polls and processes the queue serially
- **Then** the worker for the `2026-01-01` issue spawns first
- **And** the `2026-03-01` issue spawns next
- **And** the `2026-05-10` issue spawns last

#### Scenario: createdAt does not override priority

- **Given** an Urgent (priority 1) issue created `2026-05-10` and a Medium (priority 3) issue created `2026-01-01`
- **When** the coordinator sorts its queue
- **Then** the Urgent issue is ordered before the Medium issue regardless of createdAt

### Requirement: ralph list table MUST order rows within a tier by issue createdAt ascending

Rows displayed by `ralph list` MUST be sorted such that entries sharing the same PR-status tier (1–5 from `assignTier`) appear oldest-issue-first. The `SortableRow` shape MUST expose an `issueCreatedAt` ISO-8601 string sourced from `LinearIssue.createdAt`, and `sortRows` MUST use it as the first tiebreaker after `tier`.

#### Scenario: same-tier rows display oldest issue first

- **Given** three issues in the same tier with `issueCreatedAt` of `2026-02-01`, `2026-04-01`, and `2026-06-01`
- **When** `sortRows` orders the rows
- **Then** the `2026-02-01` row is first, the `2026-04-01` row is second, and the `2026-06-01` row is third
