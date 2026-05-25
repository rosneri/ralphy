# Spec: validate-only flow for no-PR tasks

## ADDED Requirements

### Requirement: validateOnComplete workflow config flag

The system SHALL support a `validateOnComplete` boolean field in `WORKFLOW.md` (default `false`). When `true` combined with `createPrOnSuccess: false`, the agent MUST activate the validate-only completion path.

#### Scenario: validateOnComplete defaults to false

Given a `WORKFLOW.md` with no `validateOnComplete` key,
when the workflow config is parsed,
then `cfg.validateOnComplete` is `false`.

#### Scenario: validateOnComplete can be enabled

Given a `WORKFLOW.md` with `validateOnComplete: true`,
when the workflow config is parsed,
then `cfg.validateOnComplete` is `true`.

---

### Requirement: validateOnComplete state flag

The system SHALL persist `validateOnComplete: boolean` (default `false`) in `StateSchema`. When the loop CLI receives `--validate-on-complete`, the initial state MUST be built with `validateOnComplete: true` and `createPr: false`.

#### Scenario: state defaults validateOnComplete to false

Given a state file with no `validateOnComplete` field,
when the state is parsed,
then `state.validateOnComplete` is `false`.

#### Scenario: validate-only worker has correct state flags

Given the agent passes `--validate-on-complete` to the loop worker,
when the loop initialises state,
then `state.validateOnComplete` is `true` and `state.createPr` is `false`.

---

### Requirement: prompt omits PR and openspec instructions for validate-only tasks

When `state.validateOnComplete` is `true` and `state.createPr` is `false`, `buildTaskPrompt` SHALL omit both the `bunx openspec validate` instruction and the `git push` / `gh pr create` block. These instructions MUST NOT appear in the prompt for validate-only tasks.

#### Scenario: PR and openspec instructions absent for validate-only

Given a state with `validateOnComplete: true` and `createPr: false`,
when `buildTaskPrompt` is called,
then the returned string does not contain `bunx openspec validate`
and does not contain `gh pr create`.

#### Scenario: PR instructions still present for PR-based tasks

Given a state with `validateOnComplete: false` and `createPr: true`,
when `buildTaskPrompt` is called,
then the returned string contains `bunx openspec validate`
and contains `gh pr create`.

---

### Requirement: runValidateOnlyPhase — check commands run before AI validation

The system SHALL provide `runValidateOnlyPhase` which MUST run each `validateCommands` entry sequentially via `sh -c`. On the first failure it MUST inject a fix task into `agent-tasks.md`, reactivate state, and respawn the worker.

#### Scenario: failing check triggers fix task and respawn

Given `validateCommands` contains one command that exits non-zero,
when `runValidateOnlyPhase` is called with `exitCode: 0`,
then a fix-task section is prepended to `agent-tasks.md`
and the worker is respawned.

#### Scenario: all checks pass and AI validation pass is injected

Given `validateCommands` contains commands that all exit zero,
when `runValidateOnlyPhase` is called,
then a `## Validate:` section is prepended to `agent-tasks.md`
and the worker is respawned exactly once for the validation pass.

#### Scenario: no validate commands skips straight to AI validation

Given `validateCommands` is empty,
when `runValidateOnlyPhase` is called,
then no check is run and the `## Validate:` section is prepended to `agent-tasks.md`.

---

### Requirement: validate-only archive skips OpenSpec status check

When `currentState.validateOnComplete` is `true` and `currentState.createPr` is `false`, `useLoop` SHALL bypass `changeStore.getStatus()` before calling `archiveChange`. The archive MUST NOT be blocked by missing OpenSpec artifacts.

#### Scenario: archive proceeds without OpenSpec check for validate-only task

Given all tasks are done and `state.validateOnComplete` is `true` and `state.createPr` is `false`,
when the loop detects task completion,
then `changeStore.getStatus()` is not called
and `archiveChange` is called directly.

#### Scenario: archive still checks OpenSpec status for PR-based tasks

Given all tasks are done and `state.validateOnComplete` is `false`,
when the loop detects task completion,
then `changeStore.getStatus()` is called before archiving.

## MODIFIED Requirements

### Requirement: PostTaskPhase enum includes validate phases

`PostTaskPhase` SHALL include `"validate"` (running check commands or AI validation pass) and `"validate-fix"` (check command failed; prepending fix task). These phases MUST be emitted to `onPhase` at the appropriate points.

#### Scenario: phase emitted during check execution

Given `runValidateOnlyPhase` is running a check command,
when the check is invoked,
then the `"validate"` phase is emitted to `onPhase`.

#### Scenario: phase emitted on check failure

Given a check command fails,
when `runValidateOnlyPhase` prepends the fix task,
then the `"validate-fix"` phase is emitted to `onPhase`.

---

### Requirement: runPostTask routes to validate-only phase

`runPostTask` SHALL call `runValidateOnlyPhase` instead of `runPrPhase` when `input.wantValidateOnly` is `true` and `exitCode === 0`. It MUST NOT execute `git push`, PR creation, or CI polling on the validate-only path.

#### Scenario: validate-only tasks skip the PR phase

Given `wantValidateOnly: true` and `exitCode: 0`,
when `runPostTask` runs,
then `runValidateOnlyPhase` is called
and no `gh pr create` command is executed.

#### Scenario: PR-based tasks are unchanged

Given `wantValidateOnly: false` and `wantPr: true` and `exitCode: 0`,
when `runPostTask` runs,
then the PR phase runs as before
and `runValidateOnlyPhase` is not called.

#### Scenario: non-zero exit skips validate phase

Given `wantValidateOnly: true` and `exitCode: 1`,
when `runPostTask` runs,
then `runValidateOnlyPhase` is not called.
