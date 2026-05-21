# RLF-130: [manual-test-S11.2] Mention "revise" + ralph:approved + conflict

Source: [RLF-130](https://linear.app/neriros/issue/RLF-130/manual-test-s112-mention-revise-ralphapproved-conflict)
Status: Todo
Labels: manual-test-rlf87-mention, manual-test-rlf87-confirm

## Why

Ralphy's confirmation gate uses two independent signals to advance an awaiting change:
the `ralph:approved` label, and a Linear/PR mention such as `@ralphy revise this`.
When both fire close together (the reviewer toggles approval but also asks for a
revision in a comment), the mention=revise intent MUST win and the change MUST go
back to design — even when the PR is in a conflicting state. A regression here
would let the approval short-circuit the revise, causing the worker to attempt a
merge instead of revising. S11.2 in the manual-test matrix exists to catch that
regression for the `confirm + mention` variant. This change records the
manual-test execution and its results for RLF-130.

## Goal

Verify mention=revise beats an approval label even with a conflict present. Variant: `confirm + mention`.

## Setup

- Reviewer comment `@ralphy revise this` on the PR.
- `ralph:approved` label flipped on/off around the comment (label race).
- PR also conflicting.

## Expected

Row 1 (mention=revise) wins regardless of the approved label. Approval is treated as superseded by the revise request.

## Regression signature

Approved short-circuits the revise — agent merges instead of revising.

## Repo / engine

[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) · claude haiku

## Execution

- Run the test from `~/Developer/ralphy-rlf87-test/` (already cloned locally; see `CLAUDE.md`, `TEST_MATRIX.md`, `README.md`, and the existing `WORKFLOW.*.md` files for prior setup).
- Workflow files: `WORKFLOW.confirm.md` + `WORKFLOW.mention.md` (variant `confirm + mention`).
- On completion, open a PR in [ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) containing a results file at `test-results/RLF-130.md` — include setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs, and any regression-signature notes.

## Bug handling

If this work finds a product bug, create a fix issue under [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) instead of fixing it in this ticket.

## What Changes

- Execute manual test S11.2 (`confirm + mention`) against `ralphy-rlf87-test` per the Linear setup: open a conflicting PR, post `@ralphy revise this`, and flip `ralph:approved` on/off around it.
- Record observed behavior and pass/fail vs. Expected in `test-results/RLF-130.md` in the `ralphy-rlf87-test` repo and open a PR there.
- Add a spec delta under `specs/manual-test-rlf-130/spec.md` capturing the precedence rule under test (mention=revise beats `ralph:approved` even with a PR conflict).
- If a product bug is observed, file a child of RLF-99 instead of patching ralphy here.

## Additional instructions

You are working on RLF-130: [manual-test-S11.2] Mention "revise" + ralph:approved + conflict.

## Goal

Verify mention=revise beats an approval label even with a conflict present. Variant: `confirm + mention`.

## Setup

- Reviewer comment `@ralphy revise this` on the PR.
- `ralph:approved` label flipped on/off around the comment (label race).
- PR also conflicting.

## Expected

Row 1 (mention=revise) wins regardless of the approved label. Approval is treated as superseded by the revise request.

## Regression signature

Approved short-circuits the revise — agent merges instead of revising.

## Repo / engine

[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) · claude haiku

## Execution

- Run the test from `~/Developer/ralphy-rlf87-test/` (already cloned locally; see `CLAUDE.md`, `TEST_MATRIX.md`, `README.md`, and the existing `WORKFLOW.*.md` files for prior setup).
- Workflow files: `WORKFLOW.confirm.md` + `WORKFLOW.mention.md` (variant `confirm + mention`).
- On completion, open a PR in [ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) containing a results file at `test-results/RLF-130.md` — include setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs, and any regression-signature notes.

## Bug handling

If this work finds a product bug, create a fix issue under [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) instead of fixing it in this ticket.

Labels: manual-test-rlf87-mention, manual-test-rlf87-confirm

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
