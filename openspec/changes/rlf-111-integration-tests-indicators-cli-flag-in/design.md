# Design: RLF-111

## Files touched

- `apps/agent/src/__tests__/indicators-s7.test.ts` — new test file
- `apps/agent/src/__tests__/cli-flags-s8.test.ts` — new test file
- `apps/agent/src/cli.ts` — cross-flag validation added to `parseAgentArgs`
- `apps/agent/src/__tests__/cli.test.ts` — updated existing boolean flags test to include `--create-pr`

## Data flow

`parseAgentArgs` validates flag co-dependencies after the arg loop and before
returning. `issueMatchesGetIndicator` already uses OR semantics; tests confirm
the contract. `AgentCoordinator` enforces `maxTickets` against active workers
and stops re-enqueuing after consecutive failure count is reached.

## Edge cases

- `--fix-ci` without `--create-pr`: throw with descriptive message
- `--stack-prs` without `--create-pr`: throw with descriptive message
- `maxTickets=1` with `concurrency=2`: only 1 worker is spawned
- `maxConsecutiveFailures=1`: coordinator does not re-enqueue after first failure
