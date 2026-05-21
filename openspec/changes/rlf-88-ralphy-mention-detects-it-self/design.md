# Design for RLF-88

## Files touched

- `apps/agent/src/agent/wire/task-bodies.ts`
  - Extend `isRalphComment`'s emoji prefix alternation to include `📋`
    so the "📋 Ralphy plan ready" gate comment is recognised as
    Ralphy-authored and skipped by the mention filter at
    `apps/agent/src/agent/wire/mention-scan.ts:117`.
  - Add a small `stripCodeMarkup(body)` helper (fenced ` ``` ` and
    inline `` ` `` spans replaced with a space) and apply it inside
    `containsHandle` before running the regex. The helper mirrors the
    logic already used by `apps/agent/src/features/confirmation/inspect.ts:19`.

- `apps/agent/src/agent/wire/__tests__/task-bodies.test.ts` _(new)_
  - Asserts `isRalphComment` covers all emojis Ralphy posts, including
    `📋`.
  - Asserts `containsHandle` rejects `@ralphy` that only appears inside
    backticks / fenced blocks, and accepts the normal "hey @ralphy"
    case.

## Data flow

`mention-scan.ts → fetchMentions()` currently does:

```
if (isRalphComment(c.body)) continue;
if (!containsHandle(c.body, handle)) continue;
```

Today the 📋 plan-ready comment passes both filters (wrong emoji set,
and `@ralphy` inside a code span counts), producing a false-positive
self-mention. After this change:

1. `isRalphComment` returns `true` for the plan-ready comment → skipped
   immediately. Primary defence.
2. Even if Ralphy posts a future comment with a different prefix that
   still references `` `@ralphy …` `` in a code span, `containsHandle`
   no longer matches because the code span is stripped before the
   regex runs. Defence in depth.

## Edge cases

- Multi-line fenced blocks: handled by the same `/```[\s\S]*?```/g`
  pattern used in `inspect.ts`.
- Unterminated backtick (e.g. `` `@ralphy ``): the `[^`\n]\*`inline
pattern won't match, so the`@ralphy` survives stripping and the
  mention still triggers — acceptable, since an unbalanced backtick is
  a user typo, not a documented example.
- Handle reconfigured to e.g. `@ralph`: the code-strip is
  handle-agnostic; behaviour is consistent.
- `findLastRalphPickupISO` is unaffected — it matches `🔁 Ralph picked
up` only.
