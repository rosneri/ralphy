# Design for RLF-245 — Mention confirm issue

## Problem

`buildMentionAckComment` echoes the human's mention back as a markdown
blockquote so the human can see what Ralphy picked up. That echo re-emits the
`@ralphy` handle inside a comment Ralphy itself authored. The duplicate-mention
loop happens when any "is this a mention?" decision relies on author identity
(or a caller-supplied `isRalph` flag) instead of the unified marker, because
then Ralphy's own ack — handle and all — reads as a fresh human mention.

The fix removes the echo (no handle to match) and makes the core filter
marker-aware (so it cannot be fooled even if the echo returns or a flag is
wrong). Both halves are cheap and independent; together they close the loop
regardless of which detection path runs.

## Current behaviour

`packages/core/src/detections/mention.ts`:

```ts
export function hasMentionTrigger(inputs: MentionInputs): boolean {
  const needle = inputs.triggerPhrase.toLowerCase();
  return inputs.comments.some((c) => !c.isRalph && c.body.toLowerCase().includes(needle));
}

export function buildMentionAckComment(body: string, author?: string): string {
  const firstLine = body.split("\n")[0]!;
  const truncated = firstLine.slice(0, 200);
  const excerpt = truncated + (truncated.length < firstLine.length ? "…" : "");
  const greeting = author
    ? `Got it, ${author} — picked up your mention and queued a review pass.`
    : `Acknowledged — picked up your mention and queued a review pass.`;
  return buildRalphyComment({
    type: "mention-ack",
    action: "picked up your mention",
    body: `${greeting}\n\n> ${excerpt}`,
  });
}
```

- `hasMentionTrigger` filters only on the caller-set `c.isRalph` boolean; it
  never inspects the body for the unified marker.
- `buildMentionAckComment` appends `\n\n> ${excerpt}` — the echoed mention.

The production scan in `apps/agent/src/agent/wire/mention-scan.ts` (lines ~170, 236) filters with `isRalphComment(c.body)` (→ `isRalphyComment` from
`@ralphy/comms`, marker-based) and a timestamp watermark, so it is robust today.
`hasMentionTrigger` is the weaker, author-flag-only sibling and is the one we
harden.

## Files to touch

| File                                                     | Change                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/detections/mention.ts`                | Drop the `> ${excerpt}` echo (and now-dead truncation locals) from `buildMentionAckComment`; make `hasMentionTrigger` also skip comments where `isRalphyComment(c.body)` is true. |
| `packages/core/src/__tests__/detections-mention.test.ts` | Replace the excerpt-quoting assertions with "no blockquote / no echo" assertions; add a `hasMentionTrigger` case for a marker-bearing Ralphy comment with `isRalph: false`.       |

No app-side changes are required: `mention-scan.ts` already imports the
marker-based `isRalphComment`, and `buildMentionAckComment`'s public signature
is unchanged.

## Data flow after the fix

1. Human comments `@ralphy please retry` on a Linear issue / GitHub PR.
2. `mention-scan` detects it (`containsHandle`, not Ralphy, past the watermark),
   reacts 👀, and posts `buildMentionAckComment(body, author)`.
3. The ack now reads:

   ```
   🤖 Ralphy · picked up your mention

   Got it, alice — picked up your mention and queued a review pass.

   <!-- ralphy:v=1 type=mention-ack -->
   ```

   No `@ralphy` handle is echoed anywhere in it.

4. Next poll: even if a detector skipped the marker check, there is no handle to
   match. And `hasMentionTrigger` now returns `false` for any
   `isRalphyComment`-recognised body regardless of `isRalph`, so the
   acknowledgment cannot be counted as a mention.

## Dependency direction

`@ralphy/core`'s `mention.ts` already imports `buildRalphyComment` from
`@ralphy/comms`, so importing `isRalphyComment` from the same package introduces
no new dependency edge.

## Edge cases

- **Empty / whitespace-only mention body** — greeting is unchanged; no excerpt
  means no special-casing of empty bodies is needed anymore.
- **Multiline mention** — previously only the first line was quoted; now nothing
  is quoted, so multiline handling is moot.
- **Legacy already-posted acks** carrying the old `> …` quote — still recognised
  as Ralphy by the marker / `🤖 Ralphy` title and by the legacy `👀 Got it`
  lead, so they remain suppressed; this change is forward-only.
- **`hasMentionTrigger` with `isRalph` correct but body marker present** — both
  guards agree (skip); no behaviour change for honest callers.
- **Genuine human comment quoting an earlier Ralphy comment** — if a human
  pastes a Ralphy comment body (marker included) and adds the trigger phrase,
  `hasMentionTrigger` would now skip it. This is an acceptable, rare trade-off:
  the production scan already keys off the human's own `@ralphy` handle via
  `containsHandle`, and the safer default is to not re-trigger on marker-bearing
  text. Documented here as a known minor behaviour shift.

## Out of scope

- The plan-ready / confirmation-gate comments (`postPlanReadyCommentOnce`) do
  not quote the mention and need no change.
- The timestamp watermark and reaction logic in `mention-scan.ts` are unchanged.
