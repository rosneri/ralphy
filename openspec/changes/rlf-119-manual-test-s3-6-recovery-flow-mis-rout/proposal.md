# RLF-119: [manual-test-S3.6] Recovery flow mis-routing into confirmation gate (RLF-87 bug)

Source: [RLF-119](https://linear.app/neriros/issue/RLF-119/manual-test-s36-recovery-flow-mis-routing-into-confirmation-gate-rlf)
Status: Todo
Labels: manual-test-rlf87-automerge, manual-test-rlf87-confirm

## Why

RLF-87 is a live regression: when a ticket is mid-flight against the confirmation gate (`confirm + automerge` variant) and `main` gains a conflicting commit that produces a `ralph:conflict` label on the PR, the confirmation feature continues to claim the ticket on every poll. The conflict-fix recovery path — which should preempt the gate, rebase the PR, clear the label, and let auto-merge close the loop — never runs, because the registry walk in `coordinator.ts` claims the ticket for the confirmation feature first, and `eligible(id)` then excludes the same id from the conflict-fix enqueue branch.

The symptom in the field is a ticket parked indefinitely behind the gate while the PR sits unmergeable. The current characterization tests (`apps/agent/src/__tests__/agent-characterization.test.ts` scenarios 3 and 5) are marked `test.failing` and assert the desired behavior (conflict-fix wins) — but there is no manual-test mission spec capturing the end-to-end reproduction against the real `ralphy-rlf87-test` repo with the `confirm + automerge` engine config. That gap is what this change fills.

This change does **not** alter agent runtime code. It introduces a manual-test capability spec that codifies the S3.6 reproduction scenario (`confirm + automerge` variant) so the bug is observable, repeatable, and the fix's success criteria are machine-checkable from the spec.

## Goal

Reproduce the live [RLF-87](https://linear.app/neriros/issue/RLF-87) bug: confirmation gate intercepting a recovery flow (conflict-fix) and parking the ticket. Variant: `confirm + automerge`.

## Setup

- Existing in-flight conflict on a PR (apply `ralph:conflict` after pushing a conflicting commit to `main`).
- Between polls, toggle confirmation mode on.

## Expected

Confirmation-gate watermark is **not** required for recovery flows. Conflict-fix continues, rebases, clears the label, and the PR auto-merges.

## Regression signature

Gate intercepts conflict-fix → ticket parks indefinitely behind the gate.

## Repo / engine

[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) · claude haiku

## What Changes

- Add a new capability `manual-test-rlf87-recovery-routing` with ADDED requirements that codify the S3.6 (confirm + automerge) reproduction scenario, including setup, trigger, expected behavior, and regression signature.
- Document the test repo (`NeriRos/ralphy-rlf87-test`), engine (`claude haiku`), and the two Linear labels that gate this mission (`manual-test-rlf87-automerge`, `manual-test-rlf87-confirm`).
- Capture the expected recovery semantics as a normative invariant the implementation must satisfy: confirmation-gate watermark MUST NOT be required for recovery flows, and a conflict-labeled ticket MUST preempt a confirmation claim on the same id.

## Out of scope

- Implementing the fix to `processAwaitingForIssue` / coordinator claim ordering. That is RLF-87's body of work; this change only ships the manual-test spec.
- Removing the `test.failing` markers in `agent-characterization.test.ts`. They are unblocked by the fix, not by the spec.
- The `confirm only` variant (non-automerge) of S3.6 — that is a separate mission ticket.

## Acceptance criteria

- `bunx openspec validate rlf-119-manual-test-s3-6-recovery-flow-mis-rout` passes.
- The spec delta under `specs/manual-test-rlf87-recovery-routing/spec.md` enumerates the reproduction steps with concrete preconditions (PR exists, `ralph:conflict` label applied after a conflicting `main` push, confirmation mode toggled on between polls) and the expected post-conditions (label cleared, PR rebased, auto-merge fires, no `awaiting: 1` bucket for the ticket).
- The spec includes a regression-signature scenario so future runs of this manual test can be scored pass/fail by inspecting agent logs (`buckets.awaiting` count, `queued (conflict-fix)` log line, label state on the PR).

## Additional instructions

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
