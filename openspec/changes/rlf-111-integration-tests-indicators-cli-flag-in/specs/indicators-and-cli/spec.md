# indicators-and-cli — integration tests for indicators & CLI flag interactions

## ADDED Requirements

### Requirement: `issueMatchesGetIndicator` MUST use OR semantics across filter elements

When an issue is evaluated against a `GetIndicator`, the `filter` array MUST be
treated as a disjunction (logical OR): the issue matches if ANY element in the
filter matches. An issue that satisfies only one of many filter elements MUST
still be considered a match.

#### Scenario: label-only filter does not match a status-only ticket

- **GIVEN** a `GetIndicator` with `filter: [{ type: "label", value: "ralph:todo" }]`
- **AND** an issue whose `state.name` is `"Todo"` and whose `labels` array is empty
- **WHEN** `issueMatchesGetIndicator` is called
- **THEN** it returns `false`

#### Scenario: OR semantics — partial match is sufficient

- **GIVEN** a `GetIndicator` with `filter: [{ type: "label", value: "A" }, { type: "status", value: "B" }]`
- **AND** an issue with `labels: ["A"]` and `state.name: "X"` (not `"B"`)
- **WHEN** `issueMatchesGetIndicator` is called
- **THEN** it returns `true` (the label element matched)

### Requirement: An issue matching multiple indicator buckets MUST be surfaced in each

The fake-linear layer MUST return an issue from every bucket whose filter it
satisfies. If an issue satisfies both `getTodo.filter` and `getInProgress.filter`,
then both `fetchTodo()` and `fetchInProgress()` MUST include it in their result
sets.

#### Scenario: issue with todo label and in-progress status appears in both buckets

- **GIVEN** indicators `getTodo: { filter: [{ type: "label", value: "ralph:todo" }] }` and `getInProgress: { filter: [{ type: "status", value: "In Progress" }] }`
- **AND** an issue with `labels: ["ralph:todo"]` and `state: { name: "In Progress", type: "started" }`
- **WHEN** `fetchTodo()` and `fetchInProgress()` are each called
- **THEN** both return lists that include the issue

### Requirement: mergeIndicators MUST replace a config key entirely when the same key is present in the CLI override

`mergeIndicators(cfg, cli)` MUST make the CLI value authoritative: when both `cfg` and `cli` carry the same key, the result MUST equal the CLI value for that key. Filter arrays MUST NOT be concatenated or merged.

#### Scenario: CLI `--indicator getTodo` replaces workflow config getTodo

- **GIVEN** a config with `getTodo: { filter: [{ type: "label", value: "cfg-label" }] }`
- **AND** a CLI-derived partial with `getTodo: { filter: [{ type: "status", value: "cli-status" }] }`
- **WHEN** `mergeIndicators(cfg, cli)` is called
- **THEN** the result's `getTodo.filter` equals `[{ type: "status", value: "cli-status" }]`
- **AND** the config label entry is NOT present in the result

### Requirement: `parseAgentArgs` MUST reject `--fix-ci` when `--create-pr` is absent

Passing `--fix-ci` without `--create-pr` MUST cause `parseAgentArgs` to throw
an error containing the text `"--fix-ci requires --create-pr"`. The same
constraint applies to `--stack-prs`.

#### Scenario: `--fix-ci` alone is rejected

- **GIVEN** an argv of `["--fix-ci"]`
- **WHEN** `parseAgentArgs` is called
- **THEN** it rejects with an error containing `"--fix-ci requires --create-pr"`

#### Scenario: `--worktree` alone is accepted

- **GIVEN** an argv of `["--worktree"]`
- **WHEN** `parseAgentArgs` is called
- **THEN** it resolves without error and the result has `worktree: true` and `createPr: false`

### Requirement: `parseAgentArgs` MUST accept `--codex` alongside `--worktree`

The `--codex` and `--worktree` flags MUST compose without error.

#### Scenario: codex engine with worktree enabled

- **GIVEN** an argv of `["--codex", "--worktree"]`
- **WHEN** `parseAgentArgs` is called
- **THEN** it resolves with `engine: "codex"` and `worktree: true`
