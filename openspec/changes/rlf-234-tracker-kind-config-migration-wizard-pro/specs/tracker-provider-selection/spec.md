# tracker-provider-selection — choose Linear or GitHub Issues as the work source

## ADDED Requirements

### Requirement: WORKFLOW.md MUST carry a tracker.kind setting defaulting to linear

The `WorkflowConfigSchema` MUST define a `tracker` block with a `kind` field whose value is `"linear"` or `"github"`, defaulting to `"linear"`. A config file with no `tracker` block MUST parse to `tracker.kind === "linear"` so that every existing Linear configuration keeps its current behavior with no edits.

#### Scenario: A v6 config with no tracker block defaults to linear

- **Given** a WORKFLOW.md written before this change with no `tracker` key
- **When** it is parsed by `WorkflowConfigSchema`
- **Then** `config.tracker.kind` equals `"linear"`
- **And** all other resolved values are identical to parsing the same file before this change

#### Scenario: An explicit github tracker is accepted

- **Given** a WORKFLOW.md with `tracker:\n  kind: github`
- **When** it is parsed by `WorkflowConfigSchema`
- **Then** `config.tracker.kind` equals `"github"`
- **And** validation succeeds

### Requirement: The github block MUST support an issues sub-block for GitHub-issue tracking

The schema's existing `github` block MUST accept an optional `issues` sub-block with `repo`, `label`, `assignee`, and a `statusLabels` map (`inProgress`, `done`, `error`). Adding `issues` MUST NOT invalidate existing `github` blocks that set only `base_branch` and/or `auto_merge_strategy`.

#### Scenario: github.issues with status labels validates

- **Given** a `github.issues` block setting `repo`, `label`, and `statusLabels.inProgress`
- **When** the config is parsed
- **Then** validation succeeds and the unset status labels resolve to their defaults (`ralph:in-progress`, `ralph:done`, `ralph:error`)

#### Scenario: A github block without issues still validates

- **Given** a `github` block that sets only `base_branch`
- **When** the config is parsed
- **Then** validation succeeds and `github.issues` is undefined

### Requirement: CURRENT_WORKFLOW_VERSION MUST be 7 and stay in sync with the migration list

`CURRENT_WORKFLOW_VERSION` MUST equal `7`, and `LATEST_MIGRATION_VERSION` MUST equal `CURRENT_WORKFLOW_VERSION`. The version-7 migration entry MUST list the new `tracker.kind` and `github.issues.*` field ids, and every listed id MUST resolve to a wizard catalogue field.

#### Scenario: Version constant equals the latest migration version

- **Given** the migrations list and the schema version constant
- **When** the sync test runs
- **Then** `CURRENT_WORKFLOW_VERSION === LATEST_MIGRATION_VERSION === 7`

#### Scenario: A v6 file is offered the new tracker fields on migration

- **Given** a WORKFLOW.md stamped `version: 6`
- **When** `pendingMigrations(6)` / `fieldsAddedSince(6)` is computed
- **Then** the result includes `tracker.kind` and the `github.issues.*` field ids

### Requirement: The agent MUST select the tracker provider by tracker.kind

`apps/agent/src/agent/wire.ts` MUST construct the issue-tracker provider based on `config.tracker.kind`. When `kind` is `linear` it MUST use the existing Linear resolver. When `kind` is `github` it MUST use a GitHub tracker provider backed by the `gh` CLI that fetches issues, applies in-progress/done/error labels, posts comments, and closes the issue on done. Both providers MUST satisfy a common `TrackerProvider` interface so the loop is agnostic to the source.

#### Scenario: linear kind resolves to the Linear provider with no behavior change

- **Given** a config with `tracker.kind: linear` (or no tracker block)
- **When** `wire.ts` builds the coordinator
- **Then** the issue source is the Linear resolver and existing agent behavior is unchanged

#### Scenario: github kind resolves to the GitHub provider

- **Given** a config with `tracker.kind: github` and a `github.issues` block
- **When** `wire.ts` builds the coordinator
- **Then** the issue source is the GitHub tracker provider, which lists issues and applies labels via the `gh` CLI
