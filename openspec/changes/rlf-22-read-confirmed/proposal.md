# RLF-22: Read Confirmed

Source: [RLF-22](https://linear.app/neriros/issue/RLF-22/read-confirmed)
Status: In Progress
Assignee: Neriya Rosner

## Problem

When a user mentions Ralphy in a Linear comment or GitHub comment/PR review, the
agent already detects the mention (via `mentionTrigger` polling in
`apps/agent/src/agent/wire.ts`) and queues work, but there is no immediate
acknowledgement on the source comment. The mentioning user has no signal that
Ralphy actually saw the mention until the spawned task posts its first reply
minutes later — leading to duplicate pings and uncertainty.

## Approach

When mention-trigger polling picks up a new `@ralphy` mention on either Linear
or GitHub, post an "eyes" emoji reaction (`👀`) directly on the triggering
comment as a best-effort acknowledgement. This is fire-and-forget: failures are
logged but never block the queued review work. The behaviour is gated on the
existing `mentionTrigger` config flag — no new config knob is required.

Implementation lives entirely in the agent app:

- **Linear**: extend `apps/agent/src/agent/linear.ts` with a `reactionCreate`
  GraphQL mutation helper.
- **GitHub**: add a `gh api ... /reactions` helper alongside the existing
  comment-fetch code in `apps/agent/src/agent/wire.ts`. Works for issue
  comments, PR review comments, and PR conversation comments using the
  appropriate REST endpoints.
- **Wire-up**: after `fetchMentions()` collects a new trigger, call the
  matching reaction helper before returning. Errors are swallowed with a log
  line — reacting is never load-bearing.

## Acceptance Criteria

- When `mentionTrigger: true` and a new `@ralphy` mention appears in a Linear
  comment, Ralphy adds a `👀` reaction to that comment within one poll cycle.
- Same behaviour for new mentions on GitHub issue comments and GitHub PR
  review comments.
- A reaction failure (network error, missing token, 4xx response) is logged
  and does not prevent the mention from being enqueued for review.
- No duplicate reactions are added on subsequent poll cycles for the same
  comment (the existing `lastRalphPickup` cursor already guarantees the
  mention is only seen once).
- Unit tests cover the Linear mutation builder, the GitHub `gh api` invocation,
  and the wire-layer "react then enqueue" sequencing including error
  swallowing.
- `bun run lint` and `bun run test` pass.

## Steering

_Add steering notes here as the loop runs._
