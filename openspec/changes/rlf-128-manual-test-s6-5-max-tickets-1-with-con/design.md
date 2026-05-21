# Design for RLF-128

## Context

`Coordinator` (apps/agent/src/runtime/coordinator.ts) tracks
`ticketsStarted` and compares it against `opts.maxTickets` in two places:

- `atTicketLimit()` (~line 411–413) — gates the enqueue path before
  launching new work in the current poll.
- The launch path (~line 1027–1030) — increments `ticketsStarted` and
  logs a cap-reached message after each successful launch.

Concurrency is enforced separately via the worker pool. The cap MUST win
whenever `maxTickets < concurrency`: even with free worker slots, no new
issue should be launched once `ticketsStarted >= maxTickets`.

## Manual test plan (S6.5, variant `basic`)

Executed in `~/Developer/ralphy-rlf87-test/` against the
`ralphy-rlf87-test` GitHub repo, engine `claude haiku`, workflow
`WORKFLOW.basic.md`.

1. Prepare two eligible Linear issues so both are visible in the same
   poll (e.g. both labelled with the workflow's pickup label, neither
   already in progress).
2. Start the agent with `--max-tickets 1 --concurrency 2` plus whatever
   flags `CLAUDE.md`/`README.md` of the test repo prescribe for `basic`.
3. Observe the first poll:
   - Exactly one worker should spawn for one of the two issues.
   - The second concurrency slot should remain idle (no second worker
     log line, no second worktree created).
4. Let the first worker complete. Confirm the second issue is **not**
   picked up — the cap is a hard process-run limit, not a sliding
   window.
5. Capture the observed behavior, relevant log excerpts, and a pass/fail
   verdict in `test-results/RLF-128.md` in the test repo, and open a PR
   there.

## Pass criteria

- Only one worker is ever launched during the run.
- No log line indicating a second-worker spawn or a breached cap.
- `ticketsStarted` reaches 1 and stops there.

## Fail criteria / regression signature

- Two workers spawned in the same poll (cap breached).
- Second issue picked up after the first completes within the same
  process run.

If a fail is observed, file a bug under RLF-99 — do not patch in this
change.

## Files touched in this repo

None. This change is documentation-only (proposal/design/spec/tasks).
The test artifact (`test-results/RLF-128.md`) lives in the
`ralphy-rlf87-test` repo and is delivered via a PR there.
