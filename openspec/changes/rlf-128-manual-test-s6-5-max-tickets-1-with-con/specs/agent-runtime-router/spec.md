# Agent runtime router — max-tickets cap under higher concurrency

## ADDED Requirements

### Requirement: The coordinator MUST cap launched tickets at `--max-tickets` even when `--concurrency` exceeds the cap

The coordinator MUST start at most `N` issues per process run when `maxTickets` is set to a positive integer `N` and `concurrency` is set to `C > N`.
Additional eligible issues visible in the same poll MUST NOT be launched
to fill the remaining `C - N` concurrency slots; those slots MUST remain
idle until the cap is lifted (which happens only on a fresh process run).

The cap MUST be enforced before a worker is spawned, not after, so the
regression signature ("two workers spawned — cap breached") cannot occur.

#### Scenario: --max-tickets 1 with --concurrency 2 and two eligible tickets

- **Given** the coordinator is started with `--max-tickets 1` and
  `--concurrency 2`
- **And** two eligible Linear issues are visible in the same poll
- **When** the coordinator enqueues work from that poll
- **Then** exactly one worker is launched for the first issue
- **And** the second concurrency slot stays idle while the first worker
  runs
- **And** the second issue is not started even after the first worker
  finishes (the cap stops new launches, it does not gate them)
