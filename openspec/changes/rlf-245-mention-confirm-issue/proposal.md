# RLF-245: Mention confirm issue

Source: [RLF-245](https://linear.app/neriros/issue/RLF-245/mention-confirm-issue)
Status: Done
Assignee: Neriya Rosner

## Why

![](https://uploads.linear.app/4b55817d-edfb-449e-806f-b872c9adf4bc/8e1b9e29-09be-4d60-a9a7-474421fbe27f/75b5ef8a-2a4f-43ee-a634-cf87e043101c)

When Ralphy picks up an `@ralphy` mention it posts a "picked up your mention"
acknowledgment comment (`buildMentionAckComment`) that **quotes the original
mention back** as a blockquote (`> @ralphy …`). That quote re-emits the handle
inside a Ralphy-authored comment.

Today the mention scan suppresses its own ack via the unified
`isRalphyComment` marker, so the production scan path is usually safe. But the
design is fragile: the only thing standing between the echoed `@ralphy` handle
and a re-trigger is that one filter recognising the comment as Ralphy's. Any
detection path that decides "is this a mention?" from author identity or a
caller-supplied `isRalph` flag — rather than from the marker — will count the
acknowledgment as a brand-new mention, producing the duplicate-mention loop in
the screenshot. The core `hasMentionTrigger` helper is exactly such a path: it
trusts `c.isRalph` and never consults the marker.

The robust fix is belt-and-suspenders: (1) stop quoting the mention in the
acknowledgment so no handle is ever echoed, and (2) strengthen the mention
filter so it recognises _any_ Ralphy-emitted message via the unified marker,
not just comments flagged `isRalph` by the caller.

## What Changes

- Remove the quoted-excerpt block (`> ${excerpt}`) from `buildMentionAckComment`
  in `packages/core/src/detections/mention.ts`; the ack keeps only its
  "Got it / Acknowledged — picked up your mention and queued a review pass"
  greeting plus the unified title and `mention-ack` marker. The excerpt
  truncation logic is no longer needed and is removed.
- Strengthen `hasMentionTrigger` (same file) so it skips a comment when it is a
  Ralphy-emitted message, recognised via the unified `isRalphyComment` marker
  from `@ralphy/comms`, **in addition to** the existing `!c.isRalph` author
  flag. A comment authored by Ralphy can no longer count as a mention even if
  the caller mis-set or omitted `isRalph`.
- Update the existing unit tests in
  `packages/core/src/__tests__/detections-mention.test.ts` to assert the ack no
  longer contains a blockquote/excerpt, and add coverage for the strengthened
  filter (a Ralphy comment that quotes/contains the trigger phrase is not
  counted as a mention even when `isRalph` is false).

## Acceptance Criteria

- `buildMentionAckComment(body, author?)` output contains the unified title
  (`🤖 Ralphy · picked up your mention`), the greeting, and the
  `<!-- ralphy:v=1 type=mention-ack -->` marker, and does NOT contain any
  blockquote line (`> …`) or any echo of the original mention body.
- `hasMentionTrigger` returns `false` for a comment recognised by
  `isRalphyComment` (e.g. one carrying the `ralphy:` marker or the `🤖 Ralphy`
  title) even when that comment contains the trigger phrase and `isRalph` is
  `false`.
- `hasMentionTrigger` still returns `true` for a genuine human comment
  containing the trigger phrase, and the existing case-insensitive / empty
  triggerPhrase / multi-comment behaviours are unchanged.
- The mention scan (`apps/agent/src/agent/wire/mention-scan.ts`) no longer has
  any path where an `@ralphy` mention-ack it posted can be re-detected as a new
  mention on a subsequent poll.
- `bun run lint` and `bun run test` pass; coverage threshold is not reduced.

## Additional instructions

You are working on RLF-245: Mention confirm issue.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
