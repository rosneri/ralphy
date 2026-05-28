# Spec: Phase-specific prompt builders

## ADDED Requirements

### Requirement: buildPhasePrompt routes to a phase-specific builder

`buildPhasePrompt(phase, state, taskDir, reviewPhase?)` MUST be exported from
`packages/core/src/loop.ts` and SHALL route to one of four phase-specific builders
based on the `TaskPhase` value. Each builder MUST produce a complete prompt string
for one iteration of the task loop.

#### Scenario: execute phase delegates to buildExecutePrompt

- **GIVEN** `phase` is `"execute"` and a state with an unchecked task in tasks.md
- **WHEN** `buildPhasePrompt("execute", state, taskDir)` is called
- **THEN** the returned prompt is identical to `buildExecutePrompt(state, taskDir)` called directly

#### Scenario: research phase returns a context-gathering prompt

- **GIVEN** `phase` is `"research"` and a state with a non-empty `state.prompt`
- **WHEN** `buildPhasePrompt("research", state, taskDir)` is called
- **THEN** the returned prompt instructs the AI to read the issue and explore relevant codebase areas
- **AND** the prompt does not reference tasks.md unchecked items

#### Scenario: plan phase returns a planning-artifact prompt

- **GIVEN** `phase` is `"plan"` and a change with stub openspec artifacts
- **WHEN** `buildPhasePrompt("plan", state, taskDir)` is called
- **THEN** the returned prompt instructs the AI to fill in proposal.md, design.md, and tasks.md in order

#### Scenario: review phase returns a self-review prompt

- **GIVEN** `phase` is `"review"`
- **WHEN** `buildPhasePrompt("review", state, taskDir)` is called
- **THEN** the returned prompt instructs the AI to read proposal.md and design.md, run `git diff main`, and write review-findings.md with open/resolved sections

### Requirement: LoopOptions accepts an optional phase field

`LoopOptions` in `packages/core/src/loop.ts` MUST gain an optional `phase?: TaskPhase` field.
When present, `useLoop` SHALL use `buildPhasePrompt` to build the iteration prompt; when absent
behavior MUST be unchanged (defaults to `"execute"`).

#### Scenario: explicit phase is used for prompt building

- **GIVEN** `LoopOptions` with `phase: "research"`
- **WHEN** `useLoop` runs an iteration
- **THEN** the prompt passed to the engine is built by `buildResearchPrompt`

#### Scenario: omitting phase preserves existing behavior

- **GIVEN** `LoopOptions` without a `phase` field
- **WHEN** `useLoop` runs an iteration
- **THEN** the prompt is identical to what `buildTaskPrompt` produced before this change

## MODIFIED Requirements

### Requirement: buildTaskPrompt is kept as a backward-compatible alias for buildExecutePrompt

The existing `buildTaskPrompt` export MUST be renamed to `buildExecutePrompt` internally.
`buildTaskPrompt` SHALL be re-exported as an alias so all existing callers continue to compile
and produce the same output without modification.

#### Scenario: buildTaskPrompt alias produces identical output

- **GIVEN** an existing caller that imports `buildTaskPrompt`
- **WHEN** `buildTaskPrompt(state, taskDir, reviewPhase)` is called
- **THEN** it returns the same string as `buildExecutePrompt(state, taskDir, reviewPhase)` called with identical arguments
