# workflow-validation Specification

## Purpose

TBD - created by archiving change rlf-112-integration-tests-negative-tests-s12-1-s. Update Purpose after archive.

## Requirements

### Requirement: WORKFLOW.md without `commands.test` MUST parse successfully

Omitting `commands.test` from WORKFLOW.md MUST succeed. The `commands` schema marks every
sub-key as `.optional()`, so `parseWorkflow` SHALL return a valid config with
`config.commands.test === undefined` when the `test` key is absent.

#### Scenario: S12.1 — missing commands.test is accepted

- **Given** a WORKFLOW.md that sets `commands.lint` but omits `commands.test`
- **When** `parseWorkflow` is called
- **Then** it returns successfully with `config.commands.test === undefined`
- **And** no error is thrown

### Requirement: WORKFLOW.md with an unrecognised indicator `type` MUST be rejected

Any unrecognised `type` value in a `getTodo.filter` entry MUST cause `parseWorkflow` to throw.
The `MarkerSchema` enumerates exactly `"label" | "status" | "attachment" | "project" | "comment"`;
any other value SHALL produce an error message containing `"invalid settings"`.

#### Scenario: S12.2 — bad indicator type "branch" is rejected

- **Given** a WORKFLOW.md that sets `getTodo.filter: [{ type: "branch", value: "main" }]`
- **When** `parseWorkflow` is called
- **Then** it throws with a message matching `"invalid settings"`

### Requirement: WORKFLOW.md with `concurrency: -1` MUST be rejected

`concurrency` is defined as `.positive()` in the schema. Negative values (including -1) MUST
cause `parseWorkflow` to throw an error whose message contains `"invalid settings"`.

#### Scenario: S12.8 — negative concurrency is rejected

- **Given** a WORKFLOW.md with `concurrency: -1`
- **When** `parseWorkflow` is called
- **Then** it throws with a message matching `"invalid settings"`

### Requirement: WORKFLOW.md with `pollIntervalSeconds: 0` MUST be rejected

`pollIntervalSeconds` is defined as `.positive()`. A value of zero MUST cause `parseWorkflow`
to throw an error whose message contains `"invalid settings"`.

#### Scenario: S12.9 �� zero poll interval is rejected

- **Given** a WORKFLOW.md with `pollIntervalSeconds: 0`
- **When** `parseWorkflow` is called
- **Then** it throws with a message matching `"invalid settings"`

### Requirement: WORKFLOW.md with an unknown top-level key MUST be accepted

The root `WorkflowConfigSchema` does not use `.strict()`. Unknown top-level keys SHALL be silently
ignored so that users on newer config versions can still run older agents without hard failures.
`parseWorkflow` MUST return a valid config when the only difference from the default is an
unrecognised root-level key.

#### Scenario: S12.10 — unknown top-level key passes

- **Given** a WORKFLOW.md with an extra key `foo: bar` at the root
- **When** `parseWorkflow` is called
- **Then** it returns successfully
- **And** the returned `config` contains all expected defaults

### Requirement: WORKFLOW.md with `specAttachmentFormats: []` MUST be rejected

`specAttachmentFormats` is declared `.nonempty()`. An empty array MUST cause `parseWorkflow`
to throw an error whose message contains `"invalid settings"`.

#### Scenario: S12.12 — empty specAttachmentFormats array is rejected

- **Given** a WORKFLOW.md with `linear.specAttachmentFormats: []`
- **When** `parseWorkflow` is called
- **Then** it throws with a message matching `"invalid settings"`

### Requirement: Linear API 401 response MUST NOT be retried

The `linearRequest` transport MUST treat HTTP 401 as a terminal, non-retryable error.
A 401 response SHALL cause an immediate throw without any additional retry attempts.
The thrown error MUST carry `error.status === 401`.

#### Scenario: S12.4 — Linear 401 throws and is not retried

- **Given** `globalThis.fetch` returns `HTTP 401` for all requests
- **When** `fetchOpenIssues` is called with any API key
- **Then** it throws an error with `error.status === 401`
- **And** `fetch` was called exactly once (no retry attempts)
