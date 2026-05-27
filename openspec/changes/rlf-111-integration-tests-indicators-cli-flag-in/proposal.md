# RLF-111: Integration tests — indicators & CLI flag interactions

Source: [RLF-111](https://linear.app/neriros/issue/RLF-111/integration-tests-indicators-cli-flag-interactions-s71-s79-s81-s810)
Status: Done
Assignee: Neriya Rosner

## Why

The indicator filter semantics (`issueMatchesGetIndicator`) and CLI flag
co-dependency rules (`--fix-ci` / `--stack-prs` require `--create-pr`) were
implemented but lacked automated test coverage. Without tests, regressions to
OR semantics, multi-bucket membership, `mergeIndicators` precedence, and the
CLI validation rules are invisible to CI.

## What Changes

- Add `indicators-s7.test.ts`: integration tests covering OR semantics across
  filter elements, label-only vs status-only mismatch, multi-bucket membership,
  and `mergeIndicators` CLI-wins behaviour.
- Add `cli-flags-s8.test.ts`: tests for `--worktree` acceptance, `--fix-ci` /
  `--stack-prs` rejection without `--create-pr`, `maxTickets` cap with higher
  concurrency, `--codex` + `--worktree` composition, and coordinator
  non-re-enqueue after consecutive worker failures.
- Add cross-flag validation in `parseAgentArgs`: throw if `--fix-ci` or
  `--stack-prs` is present without `--create-pr`.

## Acceptance criteria

- `bun run lint` and `bun run test` pass with all new test scenarios green.
- `parseAgentArgs(["--fix-ci"])` throws containing `"--fix-ci requires --create-pr"`.
- `parseAgentArgs(["--stack-prs"])` throws containing `"--stack-prs requires --create-pr"`.
- `issueMatchesGetIndicator` returns `true` on partial OR match, `false` on no match.

## Steering

_Add steering notes here as the loop runs._
