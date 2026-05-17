# RLF-59: Review loop stuck

Source: [RLF-59](https://linear.app/neriros/issue/RLF-59/review-loop-stuck)
Status: In Progress
Assignee: Neriya Rosner

## Why

A single reviewer comment on a tracked PR causes Ralph's `codeReviewTrigger`
scan (`apps/agent/src/agent/wire.ts` → `scanCodeReview`) to re-fire on every
poll, queuing the same `review` mode worker over and over. The example issue
LIT-156 shows the review process repeating against one reviewer touch.

Root cause: `scanCodeReview` debounces only via the Linear comment
`🔁 Ralph picked up new review comments`. That sentinel is the **sole**
proof that Ralph handled the activity, and:

1. It is skipped entirely when the user runs with `linear.postComments: false`
   (the `if (this.opts.postComments !== false)` guard around the pickup
   comment in `apps/agent/src/agent/coordinator.ts:605-624`), so
   `lastRalphPickup` stays `null` forever and every unresolved reviewer
   comment trips the `!lastRalphPickup || newestReviewerActivity > lastRalphPickup`
   check on every poll.
2. It can fail to post (Linear API hiccup, rate limit) — the failure is
   logged and swallowed, leaving the same hole.
3. There is a window between scan-time and pickup-comment-posting (worker
   prep + indicator + comment round-trip) where a second poll, if it raced
   in, would re-queue the same activity. `eligible()` covers
   queue/active/pending, so today that window is mostly closed in practice,
   but it relies on prep finishing before the next poll tick — fragile.

The fix is a process-local guard that does not depend on Linear round-trips.

## What Changes

- Add a process-local `Map<prUrl, isoTimestamp>` (call it
  `lastHandledReviewActivity`) in `apps/agent/src/agent/wire.ts`, mirroring
  the existing `stalePingedAt` cache used for ping debouncing.
- In `scanCodeReview`, after a trigger is built, record
  `lastHandledReviewActivity.set(prUrl, newestReviewerActivity)` so the same
  reviewer-comment timestamp cannot fire a second trigger from the same
  process.
- Before computing the trigger, short-circuit when
  `newestReviewerActivity <= lastHandledReviewActivity.get(prUrl)` — even if
  the Linear pickup comment is absent (postComments off, post failed, or
  not yet propagated).
- Leave the Linear `🔁 Ralph picked up` comment path intact — it remains the
  durable cross-restart signal; the new map is the in-process belt to the
  existing braces.
- Add unit coverage in `apps/agent/src/__tests__/` exercising the new
  short-circuit, including the `postComments: false` regression.

## Description

I only have a review once here

Seems like the review process repeats

Example:

[https://linear.app/neriros/issue/LIT-156/chapter-switched-too-quickly](https://linear.app/neriros/issue/LIT-156/chapter-switched-too-quickly)

## Steering

_Add steering notes here as the loop runs._
