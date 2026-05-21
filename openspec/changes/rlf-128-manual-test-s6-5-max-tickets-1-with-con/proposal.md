# RLF-128: [manual-test-S6.5] --max-tickets 1 with concurrency 2

Source: [RLF-128](https://linear.app/neriros/issue/RLF-128/manual-test-s65-max-tickets-1-with-concurrency-2)
Status: Todo
Labels: manual-test-rlf87-basic

## Why

The coordinator enforces a `--max-tickets N` cap intended to stop launching
new workers once N issues have been started this run, independent of the
configured `--concurrency`. Regression risk: if the gating logic sees an open
concurrency slot it may still start a second worker, breaching the cap.

This manual test exercises the boundary case where `maxTickets < concurrency`
(1 < 2) with two eligible tickets visible in the same poll. The second
concurrency slot MUST stay idle until the first ticket completes.

## What Changes

- Execute manual test scenario S6.5 against the `ralphy-rlf87-test` repo
  using workflow `WORKFLOW.basic.md`, with `--max-tickets 1` and
  `--concurrency 2` and two eligible tickets in the same poll.
- Record the observed behavior and a pass/fail verdict (vs. the Expected
  outcome and regression signature) in `test-results/RLF-128.md` inside the
  `ralphy-rlf87-test` repo, and open a PR there containing that file.
- No production code in this repo changes. If a product bug is found, file a
  fix issue under RLF-99 (do not fix here).

## Additional instructions

You are working on RLF-128: [manual-test-S6.5] --max-tickets 1 with concurrency 2.

## Goal

Verify max-tickets cap is respected when concurrency exceeds it. Variant: `basic`.

## Setup

- Run with `--max-tickets 1` and `concurrency 2`.
- Make two eligible tickets available in the same poll.

## Expected

Only one ticket starts; the second concurrency slot stays idle until the first completes.

## Regression signature

Two workers spawned — cap breached.

## Repo / engine

[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) · claude haiku

## Execution

- Run the test from `~/Developer/ralphy-rlf87-test/` (already cloned locally; see `CLAUDE.md`, `TEST_MATRIX.md`, `README.md`, and the existing `WORKFLOW.*.md` files for prior setup).
- Workflow file: `WORKFLOW.basic.md` (variant `basic`).
- On completion, open a PR in [ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) containing a results file at `test-results/RLF-128.md` — include setup steps actually taken, observed behavior, pass/fail vs. Expected, relevant logs, and any regression-signature notes.

## Bug handling

If this work finds a product bug, create a fix issue under [RLF-99](https://linear.app/neriros/issue/RLF-99/fixes-for-manual-test-rlf-87) instead of fixing it in this ticket.

Labels: manual-test-rlf87-basic

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
