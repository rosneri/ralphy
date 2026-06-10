# RLF-118: Confirmation gate respawn-loop still reproduces after RLF-105 fix — confirmation feature stops claiming on later polls

Source: [RLF-118](https://linear.app/neriros/issue/RLF-118/confirmation-gate-respawn-loop-still-reproduces-after-rlf-105-fix)
Status: Done
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Why

RLF-105 fixed one leak: a label-based `getTodo` could still pull a confirmation-claimed ticket into the fresh-pickup queue, even though the confirmation feature had claimed it from `getInProgress`. ce0c106 folded `!claimedIds.has(id)` into the shared `eligible(id)` predicate so every enqueue branch inherits the exclusion.

The reproducer in the linked Linear ticket shows the symptom still fires on the **second and subsequent polls** against the same gated ticket. Concretely: poll 2 reaps the worker for awaiting-confirmation and persists `confirmation.askedAt`; poll 3 sees the same ticket back in `fetchInProgress`, but `processAwaitingForIssue` (the confirmation feature's `detect`) returns `false`, so the coordinator's registry walk does not claim it and the legacy resume branch enqueues `RLF-101 queued (resume) → worker respawns` instead of leaving the gate gated. The cycle repeats every poll until the human approves or the run is killed.

State snapshot from the failing run shows `confirmedAt: null`, `rounds: 0`, `askedAt` set — i.e. no human signal has arrived — yet the claim still drops. Because `detectFeature` swallows any throw from a feature's `detect` and silently returns `null`, an exception inside `processAwaitingForIssue` is indistinguishable from a legitimate "ticket no longer awaiting" outcome. Today there is **no observability** to distinguish (a) the claim was intentionally released because the gate cleared, (b) `inspectAwaitingTicket` returned a terminal outcome, or (c) something threw and the claim was lost.

## What Changes

- Add per-branch diagnostic logs to `processAwaitingForIssue` so every `return false` records _why_ (gate cleared, tasks empty, outcome approved/revised, or thrown error). Logs go through the existing `onLog` channel so they land in the on-disk agent log alongside the per-poll bucket counts.
- Wrap the full body of `processAwaitingForIssue` in a top-level try/catch. On throw: log loudly with the issue identifier and error message, then **preserve the claim by returning `true`**. A reaped worker has already exited, so holding the claim for one extra poll is strictly safer than re-queuing as `resume` and respawning the worker the gate is supposed to suppress. The next poll re-runs `detect` cleanly.
- Add a regression test covering the second-poll-resume path the RLF-105 test in #235 missed: state already has `askedAt` set, no approval label, no revise comment, unchecked tasks present — assert `processAwaitingForIssue` returns `true` (i.e. the confirmation feature continues to claim the ticket across polls).
- Strengthen the `confirmation-mode` spec to document the invariant the bug violated: `inspectAwaitingTicket` MUST NOT return `approved` or `revised` without the corresponding human signal (matching approval marker, or a `<mentionHandle> revise: <reason>` comment newer than the watermark). Make the observable-on-throw behavior part of the contract.

## Out of scope

- Identifying the exact root cause of the silent throw (requires the new logs to reproduce). This change makes the next reproducer self-diagnosing without changing what the gate decides when no exception fires.
- Touching `inspectAwaitingTicket`'s outcome derivation. The user's diagnosis suggests the round-cap or implicit early-exit branches; the logs added here will pinpoint which.

## Acceptance criteria

- A reproducer that follows the Linear scenario (poll 1 fresh → poll 2 reap → poll 3 still gated) sees `awaiting: 1` on every poll after the first, with no `queued (resume)` log line for the same change.
- On every poll where the confirmation feature releases its claim, the agent log contains a one-line reason ("gate-cleared", "tasks-empty", "outcome=approved", "outcome=revised", or "threw: <msg>").
- An uncaught throw inside `processAwaitingForIssue` no longer causes the claim to drop silently — the next poll observes the same gated state and the worker is not respawned.
- New regression test in `apps/agent/src/features/confirmation/__tests__/` exercises the second-poll resume path end-to-end against the real `processAwaitingForIssue` and passes.

## Additional instructions

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
