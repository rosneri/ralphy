# RLF-150: Out of session usage loops

Source: [RLF-150](https://linear.app/neriros/issue/RLF-150/out-of-session-usage-loops)
Status: In Progress
Assignee: Neriya Rosner
Labels: Bug

## Why

When Claude hits its session usage limit (runs out of tokens for the billing period), the Claude CLI emits a `result` event with `subtype: "error"` and immediately exits. Because the process is killed intentionally when the result event fires, the exit code is normalized to 0. The loop interprets exit 0 as success and launches the next iteration — this repeated 2500 times on one ticket before someone noticed.

The fix is a two-part gate:

1. Detect usage/session limit phrases in `result-error` stream events and set `rateLimited = true`.
2. In the loop, check `rateLimited` even when exit code is 0, and stop immediately.

## What Changes

- Add `SESSION_LIMIT_PATTERNS` to `packages/engine/src/agents/claude.ts` covering "out of session", "usage limit", "context window exceeded", and related phrases.
- Check `result-error` feed events (not just `text` events) against both the existing `RATE_LIMIT_PATTERNS` and the new `SESSION_LIMIT_PATTERNS`; set `rateLimited = true` when matched.
- Mirror the same detection in `packages/engine/src/agents/scripted.ts` (the test-doubles agent), which has its own copy of the patterns.
- Add a guard in `apps/loop/src/hooks/useLoop.ts` between the non-zero exit block and the success path: if `engineResult.rateLimited` is true, log a message, record the iteration as `"failed:rate-limited"`, emit `loop.engine_rate_limited`, set `finalStopReason = "rateLimited"`, and break.
- Add unit tests for the new detection path in `packages/engine/src/__tests__/agents.test.ts` and `packages/engine/src/__tests__/engine.test.ts`.
- Add a structural assertion in `apps/loop/src/hooks/__tests__/useLoop.test.ts` verifying the guard is present.

## Acceptance Criteria

- When Claude emits a `result-error` whose message matches a usage/session limit phrase, the loop stops after that iteration with `stopReason = "rateLimited"`.
- The existing rate-limit detection for `text` events is not regressed.
- All existing tests pass; new tests cover the added detection path.

## Additional instructions

You are working on RLF-150: Out of session usage loops.

When Claude is out of tokens the agent keeps looping, we had 2500 iterations on one ticket.

Instead have a gate that exists when the usage is over

Labels: Bug

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
