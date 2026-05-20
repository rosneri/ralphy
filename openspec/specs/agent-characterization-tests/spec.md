# agent-characterization-tests Specification

## Purpose

TBD - created by archiving change rlf-89-stage-0-characterization-tests-regressio. Update Purpose after archive.

## Requirements

### Requirement: A characterization test suite MUST exercise `buildAgentCoordinator` → `pollOnce` end‑to‑end

The repository MUST contain an integration test file
`apps/agent/src/__tests__/agent-characterization.test.ts` that drives the real
`parseArgs → loadRalphyConfig → buildAgentCoordinator → coord.pollOnce()`
pipeline. Only the following collaborators MAY be faked: Linear API
(`globalThis.fetch`), `GitRunner`, `CmdRunner` (gh / generic command), the
worker subprocess (`spawnWorker`), and shell scripts (`runScript`). The
scaffold, worktree layout, indicator merging, dedupe, conflict scan, and
prepare/spawn flow MUST run for real.

The suite MUST register the following named scenarios:

1. `new ticket → approval → implement → done` (expected to pass).
2. `new ticket → revise → design → approval → implement` (expected to pass).
3. `gated ticket + PR conflicted → conflict-fix wins` (expected to FAIL today,
   pinned with `test.failing`).
4. `gated ticket + CI failing → ci-fix wins` (expected to FAIL today, pinned
   with `test.failing`).
5. `approval persisted + tasks reset for conflict-fix → no re-gate` (expected
   to FAIL today, pinned with `test.failing`).
6. `round-cap exhaustion → stuck` (expected to pass).
7. `finished + PR conflicting → conflict-fix` (expected to pass — pins the
   RLF-81 promotion behavior).

#### Scenario: green scenarios run without `test.failing`

- **Given** the characterization test file
- **When** the test runner enumerates tests
- **Then** scenarios 1, 2, 6, and 7 are registered with the plain `test(...)`
  helper (NOT `test.failing`)
- **And** `bun run test` in `apps/agent` reports them as passing

#### Scenario: three "fails today" scenarios are pinned with `test.failing`

- **Given** the characterization test file
- **When** the test runner enumerates tests
- **Then** scenarios 3, 4, and 5 are registered with `test.failing(...)`
- **And** `bun run test` in `apps/agent` reports them as passing (the test
  body throws, satisfying the `failing` expectation), so CI is green
- **And** when Stage 2 lands and the underlying behavior is fixed, removing
  `.failing` from each of the three calls is sufficient to flip them green —
  no other change to assertions is required

### Requirement: A golden-file fixture MUST pin the `--json-output` event stream for a happy-path run

The suite MUST record and assert the full sequence of `--json-output` events
emitted by a `new ticket → approval → implement → done` run against a
golden file at
`apps/agent/src/__tests__/__golden__/json-output-new-ticket.jsonl` (one JSON
event per line, ordered).

Volatile fields (timestamps, durations, absolute paths, pids, random ids)
MUST be normalised to stable tokens (e.g. `"<TIMESTAMP>"`, `"<TMPDIR>"`)
before comparison so the golden is deterministic across machines.

When the recorded stream diverges from the golden the test MUST fail with a
diff that highlights the first divergent line, and MUST point the developer
at the env var `UPDATE_GOLDEN=1` to re-record.

#### Scenario: golden matches the recorded run

- **Given** the golden file exists and matches the current behavior
- **When** the characterization test runs the happy-path scenario
- **Then** the normalised event stream equals the golden file contents
  byte-for-byte
- **And** the test passes silently

#### Scenario: `UPDATE_GOLDEN=1` rewrites the golden

- **Given** the agent's `--json-output` shape has intentionally changed
- **When** the developer runs the test with `UPDATE_GOLDEN=1`
- **Then** the test rewrites the golden file with the new normalised stream
- **And** subsequent runs without the env var pass against the new golden

### Requirement: A golden-file fixture MUST pin the PostHog event stream for a happy-path run

The suite MUST capture every PostHog `capture(...)` call emitted by the same
`new ticket → approval → implement → done` run and assert it against a
golden file at
`apps/agent/src/__tests__/__golden__/posthog-new-ticket.jsonl`. Capture
events are recorded as one JSON object per line in emission order, with the
shape `{ event, properties }`. Volatile properties MUST be normalised the
same way as the JSON output golden.

#### Scenario: PostHog stream matches the golden

- **Given** the PostHog golden file exists and matches the current behavior
- **When** the characterization test runs the happy-path scenario with the
  PostHog client fake installed
- **Then** the normalised capture stream equals the golden file contents
- **And** the test passes silently

### Requirement: The characterization suite MUST NOT modify production source

This change is a regression net only. The PR landing this change MUST NOT
edit any file outside the test directories and the `openspec/changes/`
proposal. Specifically, no file under `apps/agent/src/agent/**` (other than
new fixtures under `__tests__/`) may be modified by this change.

#### Scenario: only test and openspec files change

- **Given** the diff for the PR landing this change
- **When** a reviewer inspects which files changed
- **Then** every changed file path matches one of:
  - `apps/agent/src/__tests__/**`
  - `openspec/changes/rlf-89-stage-0-characterization-tests-regressio/**`
- **And** no `apps/agent/src/agent/**` source file is modified
