# Spec: `ralph task` top-level command

## ADDED Requirements

### Requirement: `ralph task <phase>` is a top-level CLI subcommand

`ralph task` MUST be added to the shell as a sibling of `loop` and `agent`. It SHALL accept
a phase as its first positional argument (`research`, `plan`, `execute`, or `review`) plus
all standard loop options (`--name`, `--claude`, `--max-iterations`, etc.).

#### Scenario: valid phase executes the task loop

- **GIVEN** a change named `foo` exists and phase `execute` is provided
- **WHEN** the user runs `ralph task execute --name foo --claude sonnet`
- **THEN** the TUI starts and the loop runs the execute phase — behavior identical to `ralph loop task --name foo --claude sonnet`

#### Scenario: missing phase produces an error

- **GIVEN** the user omits the phase positional argument
- **WHEN** the user runs `ralph task --name foo`
- **THEN** the process exits with code 1 and prints an error message listing the valid phases

#### Scenario: unknown phase string produces an error

- **GIVEN** the user provides an unrecognized phase string `hack`
- **WHEN** the user runs `ralph task hack --name foo`
- **THEN** the process exits with code 1 and prints `Unknown phase 'hack'. Valid phases: research, plan, execute, review`

#### Scenario: missing --name produces an error

- **GIVEN** a valid phase but no `--name` flag
- **WHEN** the user runs `ralph task execute`
- **THEN** the process exits with code 1 and prints `--name is required`

#### Scenario: help flag prints usage and exits 0

- **GIVEN** the `--help` flag
- **WHEN** the user runs `ralph task --help`
- **THEN** the process exits with code 0 and prints usage text that includes all four valid phases

## MODIFIED Requirements

### Requirement: Shell routes `ralph task` to taskMain with standard telemetry

`apps/shell/src/index.ts` MUST add `"task"` to its `SUBCOMMANDS` set and SHALL dispatch it
to `taskMain` exported from `@ralphy/loop`. Telemetry MUST be initialised identically to `loop` and `agent`.

#### Scenario: shell dispatches task subcommand to taskMain

- **GIVEN** the user invokes `ralph task execute --name foo`
- **WHEN** the shell processes the argv
- **THEN** it calls `taskMain(["execute", "--name", "foo"])` from `@ralphy/loop`
- **AND** telemetry is captured with `subcommand: "task"`

#### Scenario: existing loop and agent invocations are unaffected

- **GIVEN** an existing script using `ralph loop task --name foo` or `ralph agent`
- **WHEN** the updated shell binary is invoked
- **THEN** behavior is identical to before this change
