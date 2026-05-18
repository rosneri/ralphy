# RLF-65: Rate limit reached

Source: [RLF-65](https://linear.app/neriros/issue/RLF-65/rate-limit-reached)
Status: In Progress
Assignee: Neriya Rosner

## Why

The mention scan calls Linear's GraphQL API repeatedly (one `fetchIssueComments` per
candidate, plus a reaction write per matched comment). Under sustained load, Linear
starts rejecting requests with rate-limit signals. Two failure modes show up in
practice:

1. Linear returns **HTTP 429** with a JSON body.
2. Linear returns **HTTP 400** with a body containing the phrase
   `Rate limit exceeded` — same condition, different status code.

The current code only treats 429 as retryable (and retries it inside `linearRequest`).
The 400-with-body case bubbles up as a generic Linear error, the mention scan keeps
looping through candidates, and the agent floods the log with `Linear comments
failed for RLF-…` lines while continuing to hammer Linear and burn rate budget.

## What Changes

- `linearRequest` recognises both HTTP 429 **and** a body-substring match for
  `Rate limit exceeded` as rate-limit signals. Rate-limited errors are tagged with
  `rateLimited = true` and thrown immediately — no retry path.
- `isRetryableStatus` drops 429 from its retryable set (rate-limit errors now bubble
  up instead of being silently retried).
- A new exported helper `isRateLimitedError(err)` lets callers detect tagged errors
  without inspecting internal shape.
- `formatLinearError` prepends `rate limited` (and elides the long body) for
  rate-limited errors so logs stay short and on-point.
- `fetchMentions` in `apps/agent/src/agent/wire.ts` aborts the mention scan on the
  first rate-limit signal: it logs one yellow `! mention scan: rate limited,
deferring rest of scan to next poll` line and returns the mentions collected so
  far (empty if the candidate fetch itself failed).

## Description

Detect Linear rate-limit responses (HTTP 429 or HTTP 400 with `Rate limit exceeded`
body) and abort the current mention scan cleanly instead of cascading dozens of
failures into the log.

## Additional instructions

You are working on RLF-65: Rate limit reached.

Project rules:

- use Bun-native APIs (`Bun.spawn` / `Bun.file`) — never `node:fs` sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
