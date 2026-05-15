# agent-queue-order — coordinator queue ordering

## ADDED Requirements

### Requirement: coordinator queue MUST be ordered by a single named comparator

The agent coordinator MUST sort its pending-work queue using a single named
comparator that composes, in this order: (1) auto-merge conflict-fix boost,
(2) Linear priority (1=Urgent first, 0=No-priority last), (3) spawn-mode rank
(`resume` < `conflict-fix` < `review` < `fresh`), (4) `createdAt` ascending
(FIFO). The comparator MUST live in its own module (`queue-order.ts`) and be
unit-testable without instantiating `AgentCoordinator`.

`LinearIssue` MUST carry a `createdAt: string` field fetched from the Linear
GraphQL API so the FIFO tiebreaker has a stable input.

#### Scenario: auto-merge conflict-fix beats higher-priority fresh work

- **Given** issue A is `conflict-fix` mode with auto-merge enabled and priority 4 (Low)
- **And** issue B is `fresh` mode with priority 1 (Urgent)
- **When** both are enqueued and sorted by `compareQueueEntries`
- **Then** A sorts before B

#### Scenario: FIFO breaks ties within the same priority and mode

- **Given** two `fresh` issues both have priority 3 (Medium)
- **And** issue X has `createdAt = 2026-04-01T00:00:00Z`
- **And** issue Y has `createdAt = 2026-05-01T00:00:00Z`
- **When** they are enqueued and sorted
- **Then** X sorts before Y

#### Scenario: spawn-mode rank breaks ties when priority is equal

- **Given** two priority-2 (High) issues, one in `resume` mode and one in `fresh` mode
- **When** they are enqueued and sorted
- **Then** the `resume` issue sorts before the `fresh` issue
