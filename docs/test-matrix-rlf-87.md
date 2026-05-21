# RLF-87 Extended Test Matrix

Tracker for the 89-scenario coverage matrix exercising the RLF-87 architecture
(capabilities / detections / flows with an explicit runtime router).

Source of truth: [RLF-106](https://linear.app/neriros/issue/RLF-106/extended-test-matrix-for-rlf-87-89-scenarios).
The authoritative scenario list lives as `TEST_MATRIX.md` attached to RLF-106
on Linear. This file mirrors the _work breakdown_ — which child ticket owns
which scenarios — and is the in-repo entry point for anyone implementing or
reviewing matrix work.

## Areas (S1–S12)

| Area | Theme                                | Ownership                               |
| ---- | ------------------------------------ | --------------------------------------- |
| S1   | Capabilities                         | RLF-109 (automated)                     |
| S2   | Detections                           | RLF-109 (automated)                     |
| S3   | Flows + PR lifecycle                 | RLF-113 (automated, excl. S3.6)         |
| S3.6 | Recovery flow mis-routing            | RLF-119 (manual — RLF-87 bug)           |
| S4   | Runtime router edge cases            | RLF-120…RLF-127 (manual, one per scen.) |
| S5   | State store                          | RLF-110 (automated)                     |
| S6   | Runtime signals                      | RLF-114 (automated, excl. S6.5)         |
| S6.5 | `--max-tickets 1` with concurrency 2 | RLF-128 (manual)                        |
| S7   | Indicators                           | RLF-111 (automated)                     |
| S8   | CLI flags                            | RLF-111 (automated)                     |
| S9   | OpenSpec lifecycle                   | RLF-110 (automated)                     |
| S10  | PR lifecycle                         | RLF-113 (automated)                     |
| S11  | Multi-signal interactions            | RLF-129…RLF-136 (manual, one per scen.) |
| S12  | Negative tests                       | RLF-112 (automated)                     |

## Automated work (mocked harness)

The mock provider harness landed in RLF-108 (PR #240). All automated scenarios
import `createHarness` from `apps/agent/test/harness` — see the `test-harness`
capability spec for the contract.

| Ticket  | Scope                                     |
| ------- | ----------------------------------------- |
| RLF-108 | Mock provider harness _(prereq)_          |
| RLF-109 | Capabilities + Detections (S1, S2)        |
| RLF-110 | State store + OpenSpec lifecycle (S5, S9) |
| RLF-111 | Indicators + CLI flags (S7, S8)           |
| RLF-112 | Negative tests (S12)                      |
| RLF-113 | Flows + PR lifecycle (S3 excl. S3.6, S10) |
| RLF-114 | Runtime signals (S6 excl. S6.5)           |

## Manual work (live engine + real concurrency)

Manual scenarios run against the private test repo
[ralphy-rlf87-test](https://github.com/NeriRos/ralphy-rlf87-test) using the
claude haiku engine (codex for S8.9 only). Each scenario is its own child
ticket so reproductions are independently trackable.

| Ticket  | Scenario | Description                                |
| ------- | -------- | ------------------------------------------ |
| RLF-119 | S3.6     | Recovery flow mis-routing (RLF-87 bug)     |
| RLF-120 | S4.1     | Router empty signals                       |
| RLF-121 | S4.2     | awaiting=approved skips confirmation       |
| RLF-122 | S4.3     | SIGTERM ignored by hung worker             |
| RLF-123 | S4.4     | Preempt with no worker                     |
| RLF-124 | S4.5     | Two signals same poll: mention + conflict  |
| RLF-125 | S4.6     | Single-writer-per-field violation          |
| RLF-126 | S4.7     | Preempt swap survives teardown crash       |
| RLF-127 | S4.8     | Boost-band must not leak into router       |
| RLF-128 | S6.5     | `--max-tickets 1` with concurrency 2       |
| RLF-129 | S11.1    | Gate + external PR + conflict + CI red     |
| RLF-130 | S11.2    | Mention revise + approved + conflict       |
| RLF-131 | S11.3    | Stuck + new-ticket mention + idle          |
| RLF-132 | S11.4    | Awaiting-CI + conflict + mention           |
| RLF-133 | S11.5    | SIGINT during preemption swap              |
| RLF-134 | S11.6    | Two tickets at max-tickets boundary        |
| RLF-135 | S11.7    | Capability retry exhaustion mid-preemption |
| RLF-136 | S11.8    | Mention + gate + state file deleted        |

## Workflow variants

The test repo ships `basic`, `confirm`, `mention`, `automerge`. The matrix
also exercises `dup-key`, `dup-bucket`, `bad-clear`, `codex`, `confirm+manual`,
`parallel`, and `dup-change` — added per-scenario as needed.

## Process

The bug-only model applies: new repros land as child tickets under
[RLF-99](https://linear.app/neriros/issue/RLF-99), **not** by expanding this
tracker.
