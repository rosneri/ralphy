# Spec: TUI pending-confirmation counter

## ADDED Requirements

### Requirement: TUI MUST cap [GATE] cards to 1 and show a counter for the rest

When N ≥ 1 tickets are in the awaiting-confirmation state, the TUI gated-tickets section MUST render exactly **one** full `[GATE]` card — the ticket whose `since` timestamp (`confirmation.askedAt`) is most recent. When N > 1 a dimmed `+{N-1} more awaiting confirmation` line MUST appear immediately below the single card. `null` `since` values MUST be treated as epoch 0 (oldest).

#### Scenario: single gated ticket renders one card with no counter

- **Given** one ticket is in the awaiting-confirmation state
- **When** the TUI renders the gated-tickets section
- **Then** exactly one `[GATE]` card is rendered
- **And** no `+N more awaiting confirmation` line is rendered

#### Scenario: multiple gated tickets shows only the latest card plus counter

- **Given** three tickets A, B, C are awaiting-confirmation with since values "2026-01-01", "2026-03-01", "2026-02-01" respectively
- **When** the TUI renders the gated-tickets section
- **Then** exactly one `[GATE]` card is rendered for ticket B (newest since)
- **And** a `+2 more awaiting confirmation` line is rendered below it

#### Scenario: null since is treated as oldest when selecting the latest ticket

- **Given** two tickets: A with since=null and B with since="2026-01-01T00:00:00.000Z"
- **When** pickLatestGatedTicket is called
- **Then** ticket B is returned as the top entry
- **And** moreCount is 1

### Requirement: pickLatestGatedTicket MUST be an exported pure function in AgentMode

`pickLatestGatedTicket<T extends { since: string | null }>(tickets: Map<string, T>): { top: [string, T] | null; moreCount: number }` MUST be exported from `apps/agent/src/components/AgentMode.tsx` and MUST be a pure function with no side effects.

#### Scenario: empty map returns null top and zero moreCount

- **Given** an empty gated-tickets map
- **When** pickLatestGatedTicket is called
- **Then** top is null and moreCount is 0

#### Scenario: single entry returns that entry with moreCount 0

- **Given** a gated-tickets map with exactly one entry with since="2026-05-01"
- **When** pickLatestGatedTicket is called
- **Then** top is that single entry and moreCount is 0

#### Scenario: multiple entries returns entry with newest since and correct moreCount

- **Given** a gated-tickets map with three entries (since: "2026-01-01", "2026-03-01", "2026-02-01")
- **When** pickLatestGatedTicket is called
- **Then** top is the entry with since="2026-03-01"
- **And** moreCount is 2
