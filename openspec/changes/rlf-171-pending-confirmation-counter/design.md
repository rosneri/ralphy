# Design for RLF-171

## Files to Touch

**`apps/agent/src/components/AgentMode.tsx`** (primary change)

- Export `pickLatestGatedTicket<T extends { since: string | null }>(tickets: Map<string, T>): { top: [string, T] | null; moreCount: number }`.
- Sort by `since` descending (newest ISO string first; `null` treated as epoch 0).
- Replace the `Array.from(gatedTicketsRef.current.entries()).map(...)` block with a call to this helper so only the latest `[GATE]` card is rendered.
- When `moreCount > 0`, render a single dimmed `+{moreCount} more awaiting confirmation` line below the card.

**`apps/agent/src/__tests__/pending-tasks.test.ts`** (tests)

- New `describe("pickLatestGatedTicket", ...)` block covering: empty map → `{ top: null, moreCount: 0 }`; single ticket → `moreCount: 0`; multiple tickets → newest `since` wins; `null` since is treated as oldest.

## Data Flow

1. Each `onAwaitingTicket` callback fires → `gatedTicketsRef.current.set(changeName, { ..., since, ... })` (unchanged).
2. On render: `pickLatestGatedTicket(gatedTicketsRef.current)` selects the entry with the most recent `since` timestamp.
3. Render: one `[GATE]` card for the top entry. If `moreCount > 0`, a dimmed text line `+{moreCount} more awaiting confirmation` follows.

## Edge Cases

- `gatedTicketsRef` is cleared at the start of every poll. Tickets that leave the gate disappear on the next render frame — no additional cleanup needed.
- `since` is nullable (`askedAt` not yet set when the plan-ready comment hasn't been posted). Null `since` sorts as epoch 0, making it the oldest, not the latest.
- The `awaiting` bucket in the POLL STATUS box already shows the total count independently and is unchanged.
- When there is exactly 1 gated ticket the `+N more` line is not rendered (`moreCount === 0`).
