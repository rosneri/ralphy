# test-harness Specification

## Purpose

TBD - created by archiving change rlf-108-mock-provider-harness-for-rlf-106-integr. Update Purpose after archive.

## Requirements

### Requirement: The agent package MUST ship a mock provider harness for integration/e2e tests

The `apps/agent` package MUST expose a test-only harness under `apps/agent/test/harness/` providing in-memory fakes for every external provider the agent loop talks to: Linear, `gh`, `git`, the filesystem rooted at `.ralph/` + `openspec/`, the engine (claude/codex), and the wall-clock / poll driver.

The harness MUST be importable from any test under `apps/agent/src/**/__tests__/` and MUST NOT be imported from production source files. The harness MUST NOT make real network calls, real engine calls, or write outside its own tmpdir during a test run.

#### Scenario: Harness wires fakes into the coordinator

- **Given** a test imports `createHarness` from `apps/agent/test/harness`
- **When** the test calls `await createHarness({ scenario: "s1.1-fresh-todo" })`
- **Then** the returned object exposes a `coordDeps` matching the `CoordinatorDeps` shape
- **And** every Linear call routes through the in-memory fake (no GraphQL request escapes)
- **And** every `gh` invocation routes through the fake `CmdRunner` (no `gh` subprocess is spawned)
- **And** the engine driver is a scripted transcript player (no claude/codex subprocess is spawned)
- **And** the working git repo lives inside a tmpdir created by the harness

#### Scenario: Smoke test exercises fresh-todo → done end-to-end

- **Given** a harness seeded with a single fresh-todo Linear issue and a transcript that exits 0 after one passing diff
- **When** the test drives `coord.pollOnce()` then `h.runWorkerToCompletion()`
- **Then** `setInProgress` is recorded against the issue
- **And** the scripted engine transcript is fully consumed
- **And** `setDone` is recorded against the issue
- **And** the recorded PR URL matches the one scripted into the fake `gh`

#### Scenario: Unscripted engine step fails the test

- **Given** a scripted engine transcript with N steps
- **When** the agent under test requests step N+1
- **Then** the harness throws an "unscripted step" error
- **And** the failing test surfaces the missing step in its message

#### Scenario: Cleanup removes all temp state

- **Given** a test created a harness and ran a scenario
- **When** the test calls `await h.cleanup()`
- **Then** every tmpdir created by the harness is removed
- **And** no background timers or open file handles remain
