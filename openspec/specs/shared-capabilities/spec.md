# shared-capabilities Specification

## Purpose

TBD - created by archiving change rlf-93-stage-4-shared-capabilities-extraction. Update Purpose after archive.

## Requirements

### Requirement: Capability descriptor and shell

Every I/O surface used by the agent SHALL be exposed as a `Capability<TArgs, TResult>` descriptor with fields `{ name, required, retryPolicy, errorFormatter, adopt?, run }`, and invoked through the shared `runCapability(cap, args, { bus })` shell.

#### Scenario: Successful call emits started and fetched events

- **WHEN** `runCapability` invokes a capability named `linear.tickets.fetch` and `cap.run` resolves
- **THEN** the bus receives one `linear.tickets.fetch.started` event followed by one `linear.tickets.fetch.fetched` event, in that order
- **AND** the resolved value is returned to the caller

#### Scenario: Retry honors retryPolicy

- **WHEN** `cap.run` throws an error for which `retryPolicy.isRetryable` returns `true`
- **AND** the attempt index is less than `retryPolicy.maxAttempts`
- **THEN** `runCapability` waits `retryPolicy.delayMs(attempt, err)` ms and retries
- **AND** does NOT emit `.failed` between attempts

#### Scenario: Required capability never returns on failure

- **GIVEN** `cap.required === true`
- **WHEN** every retry attempt throws
- **THEN** `runCapability` emits `${cap.name}.failed` and rethrows the formatted error
- **AND** never returns a value to the caller (no fallback path exists in the shell)

### Requirement: Linear client retries 429 and surfaces structured errors

The `linear-client` capability SHALL retry HTTP 429 and 5xx responses with exponential backoff that honors the `Retry-After` header (clamped to 2000ms), and its `errorFormatter` SHALL return a string containing the HTTP status, a body truncated to a fixed length, and any GraphQL `errors[].message` values.

#### Scenario: 429 with Retry-After is retried

- **WHEN** the Linear endpoint responds 429 with `Retry-After: 1` on attempt 1
- **AND** responds 200 on attempt 2
- **THEN** `runCapability` waits ~1000ms (clamped) before attempt 2 and returns the success body

#### Scenario: Failure formatter includes status and GraphQL messages

- **WHEN** the Linear endpoint responds 400 with body `{"errors":[{"message":"X"}]}`
- **THEN** the thrown error's formatted message contains `"400"`, the truncated body, and `"X"`

### Requirement: Worktree capability is required and never returns projectRoot

The `git.createWorktree` capability SHALL declare `required: true`. When forced creation fails, the capability SHALL NOT produce a result whose `cwd` equals `projectRoot`, and the calling flow SHALL apply the `ralph:error` label to the originating Linear issue.

#### Scenario: Forced creation failure quarantines ticket

- **GIVEN** an issue whose `useWorktree` is enforced
- **WHEN** `git.createWorktree` throws
- **THEN** `runCapability` rethrows (no result is produced)
- **AND** the caller applies `ralph:error` to the issue
- **AND** no worker is spawned with `cwd === projectRoot`

### Requirement: Worker spawner takes a uniform argument and the SpawnMode enum is removed

The worker spawner SHALL be invoked as `spawnWorker({ cwd, changeName, steeringNote?, prependTask? })`. The previous `SpawnMode` enum (`"fresh" | "resume" | "conflict-fix" | "review"`) SHALL be removed from the codebase, and call sites that previously branched on it SHALL perform their task-prepend via `fs-change.prependTask` before calling `spawnWorker`.

#### Scenario: Conflict-fix spawn prepends via fs-change

- **GIVEN** a conflicted change `foo`
- **WHEN** the coordinator decides to spawn a conflict-fix worker
- **THEN** it calls `fsChange.prependTask("foo", <conflict directive>)` first
- **AND** then calls `spawnWorker({ cwd, changeName: "foo" })` with no mode argument

#### Scenario: No references to SpawnMode remain

- **WHEN** the repo is searched for `SpawnMode`
- **THEN** no source files match

### Requirement: PollContext lives one tick and memoizes per call

The `PollContext` SHALL be instantiated at the start of each poll cycle and discarded at the end. Within a cycle, identical `(url, fields)` pairs SHALL return the same in-flight or resolved promise; field-array order SHALL NOT affect the memoization key.

#### Scenario: Same URL and fields are memoized

- **WHEN** `ctx.fetchPrOnce(url, ["a","b"], runner, cwd)` is called twice in the same poll
- **THEN** the underlying `gh pr view` runner is invoked exactly once

#### Scenario: Field order does not affect cache key

- **WHEN** `ctx.fetchPrOnce(url, ["b","a"], runner, cwd)` is called after `ctx.fetchPrOnce(url, ["a","b"], runner, cwd)`
- **THEN** the second call returns the first call's promise (no new runner invocation)

#### Scenario: Memo does not survive a new PollContext

- **WHEN** a new `PollContext` is created
- **THEN** prior memoization from a previous instance is not visible

### Requirement: ESLint no-restricted-imports enforces layering (warn)

The repository's ESLint configuration SHALL include a `no-restricted-imports` rule at severity `warn` that flags: cross-feature imports under `apps/agent/src/agent/*`, imports from features into `runtime/` or `consumers/`, imports from `consumers/` into `features/` or `capabilities/`, and I/O imports (Linear/gh/git/child_process) inside any file named `detect.ts`.

#### Scenario: Cross-feature import is warned

- **GIVEN** a file `apps/agent/src/agent/featureA/index.ts` that imports from `apps/agent/src/agent/featureB/whatever`
- **WHEN** `bun run lint` runs
- **THEN** ESLint reports a `no-restricted-imports` warning (not an error) on that line

#### Scenario: I/O import inside detect.ts is warned

- **GIVEN** a file matching `**/detect.ts` that imports `../../shared/capabilities/linear-client`
- **WHEN** `bun run lint` runs
- **THEN** ESLint reports a `no-restricted-imports` warning on that import
