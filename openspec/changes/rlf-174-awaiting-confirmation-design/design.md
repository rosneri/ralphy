# Design for RLF-174

## Overview

All changes are confined to a single file: `apps/agent/src/components/AgentMode.tsx`.

## Affected code

### Rendering block (lines 1072-1118)

The IIFE that renders the gated-tickets card currently calls `pickLatestGatedTicket` and renders a single card plus optional "+N more" text.

After this change:

1. **Size 0** → unchanged (returns null).
2. **Size 1** → unchanged (existing single-ticket card with identifier in label, round, asked-ago, title).
3. **Size ≥ 2** → new multi-ticket card:
   - **Label**: space-padded horizontal list of all identifiers as `<Link>` nodes separated by `<Text color="yellow"> · </Text>`.
   - **Label visual width**: sum of all identifier lengths + `(count - 1) × 3` for each `·` separator + 2 for the leading/trailing space padding.
   - **Body**: `[GATE]  Awaiting confirmation · N tickets` — omits round/asked-ago/title because those are per-ticket and there is no single representative ticket.
   - The `+N more` dim text below the card is removed.

The `pickLatestGatedTicket` helper remains unchanged; it is no longer called for the multi-ticket path but is still used for the single-ticket path and remains exported (tests depend on it).

### Helper for sorted entries

The multi-ticket rendering sorts entries by `since` descending (newest first, null treated as epoch 0) — the same ordering `pickLatestGatedTicket` already uses. This is inlined in the IIFE using `Array.from(...).sort(...)`.

## Data flow

```
gatedTicketsRef.current  (Map<changeName, { issueIdentifier, issueUrl, issueTitle, since, round }>)
  → size check
      size === 0  →  null
      size === 1  →  single-ticket card (unchanged)
      size >= 2   →  multi-ticket card with horizontal link list in label
```

## Edge cases

- **Long identifier list** — `LabeledBox` receives an explicit `labelVisualWidth`; if the computed width exceeds `termWidth - 4`, the box border calculation may wrap. The label will still render correctly because Ink truncates gracefully; no special truncation is needed.
- **All `since` values null** — sort is stable (Map insertion order preserved among ties), so the order is deterministic.
- **Single-ticket path** — completely unaffected; no regression risk.

## Files to touch

| File                                      | Change                                          |
| ----------------------------------------- | ----------------------------------------------- |
| `apps/agent/src/components/AgentMode.tsx` | Modify the gated-tickets IIFE (lines 1072-1118) |

## No package changes required

This is a pure UI rendering change with no new exports, no new types, and no changes to the confirmation state machine.
