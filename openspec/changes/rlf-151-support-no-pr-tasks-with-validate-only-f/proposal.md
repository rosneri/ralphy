# RLF-151: Support no-PR tasks with validate-only flow

Source: [RLF-151](https://linear.app/neriros/issue/RLF-151/support-no-pr-tasks-with-validate-only-flow)
Status: Done
Assignee: Neriya Rosner
Labels: Feature

## Why

Some tasks (administrative work, config changes, documentation updates) should complete without opening a GitHub PR or going through the OpenSpec-based post-task flow. The current loop and post-task machinery assumes a PR/OpenSpec-oriented completion path, which forces these simpler tasks to carry unnecessary scaffolding. Adding a dedicated validate-only path lets them finish cleanly using normal test execution plus one AI self-check pass.

## Problem

The current loop and post-task flow assume a PR/OpenSpec-oriented completion path:

- task prompt construction can inject PR creation behavior
- post-task handling is built around PR/review-style follow-up
- archive/completion checks can depend on OpenSpec validation status

That makes simple tasks harder to run when they only need normal tests and one validation pass before either completing or being sent back for another iteration.

## Goal

Support a no-PR path where a task can:

- skip PR creation entirely
- skip OpenSpec-specific completion checks
- run regular test/lint/typecheck checks before a validation pass
- run one AI validation pass after checks succeed
- if validation fails, send the work back for another iteration using the existing task injection mechanism

## Proposed implementation

### Configuration and state

Add a workflow config flag `validateOnComplete` (boolean, default `false`) to `WorkflowConfigSchema`. The new flow is active when both conditions hold at worker-spawn time:

- `createPr = false` in state (the agent did not inject `--create-pr` into the worker command)
- `validateOnComplete = true` in state (the agent injected `--validate-on-complete`)

The agent wire derives this from `cfg.validateOnComplete && !wantPrBase` and passes `--validate-on-complete` to the worker command. The worker CLI flag sets `state.validateOnComplete = true` and prevents `state.createPr` from being set (it is only set when `fromAgent && !validateOnComplete`).

### Loop and prompt behavior

`buildTaskPrompt` already guards PR creation instructions behind `state.createPr`. When `state.validateOnComplete && !state.createPr` the prompt additionally omits the `bunx openspec validate` instruction (no OpenSpec artifact is expected for admin tasks).

### Post-task behavior

A new exported `runValidateOnlyPhase` function in `post-task.ts` handles the post-worker steps:

1. Run `cfg.validateCommands` (derived from `commands.test/lint/typecheck` in WORKFLOW.md) one by one.
2. On any failure: prepend a fix task to `agent-tasks.md` and respawn the worker (reuses `runWorkerWithFixTask` logic).
3. On all passing: prepend a `## Validate: verify your work is complete` task to `agent-tasks.md` and respawn the worker — this is the single AI validation pass.
4. The worker either marks the validation task done (pass) or prepends new fix tasks and marks it done (fail → loop continues). No PR or OpenSpec interaction occurs at any point.

`runPostTask` routes into `runValidateOnlyPhase` when `input.wantValidateOnly && exitCode === 0`.

### Archive

`useLoop` skips the `changeStore.getStatus()` OpenSpec check before archiving when `currentState.validateOnComplete && !currentState.createPr`, allowing the change to archive without an OpenSpec artifact.

## What Changes

- `WorkflowConfigSchema` (`packages/workflow/src/schema.ts`) gains `validateOnComplete: boolean` (default `false`).
- `StateSchema` (`packages/types/src/types.ts`) gains `validateOnComplete: boolean` (default `false`).
- `BuildInitialStateOptions` (`packages/core/src/state.ts`) gains `validateOnComplete?: boolean`; `buildInitialState` passes it through to the state.
- `LoopOptions` (`packages/core/src/loop.ts`) gains `validateOnComplete?: boolean`.
- `buildTaskPrompt` skips `bunx openspec validate` instruction and PR push instructions when `state.validateOnComplete && !state.createPr`.
- Loop CLI (`apps/loop/src/cli.ts`) gains `--validate-on-complete` flag; `ParsedArgs` gains `validateOnComplete: boolean`.
- `App.tsx` passes `validateOnComplete: args.validateOnComplete` to `useLoop` and sets `createPr: args.fromAgent && !args.validateOnComplete`.
- `PostTaskPhase` (`apps/agent/src/agent/post-task.ts`) gains `"validate"` and `"validate-fix"` values.
- `PostTaskInput` gains `wantValidateOnly?: boolean`; `PostTaskInput.cfg` gains `validateCommands?: string[]`.
- New exported `runValidateOnlyPhase` function in `post-task.ts` handles check execution and one AI validation pass via `agent-tasks.md` injection.
- `runPostTask` calls `runValidateOnlyPhase` when `wantValidateOnly && exitCode === 0`, in place of the PR phase.
- Wire layer (`apps/agent/src/agent/wire/spawn/worker.ts`) derives `wantValidateOnly = cfg.validateOnComplete && !wantPrBase`; adds `--validate-on-complete` to the worker command and populates `cfg.validateCommands` from workflow `commands.test/lint/typecheck`.
- `useLoop` (`apps/loop/src/hooks/useLoop.ts`) passes `validateOnComplete` from `LoopOptions` to `buildInitialState` and bypasses `changeStore.getStatus()` when `currentState.validateOnComplete && !currentState.createPr`.

## Acceptance criteria

- Tasks can be configured to complete without creating a PR.
- When the no-PR validate-only path is enabled, PR creation instructions are not added anywhere in the task flow.
- The task runs configured checks (test/lint/typecheck) before validation.
- After checks pass, exactly one AI validation pass is executed (via agent-tasks injection).
- If validation fails, the system adds a new follow-up task and sends the work back for another iteration.
- If validation passes, the task can complete without OpenSpec archive/status requirements.
- Existing PR-based flows continue to behave unchanged.

## Notes for implementation

- Prefer adding this as an explicit branch in existing post-task handling rather than creating a separate flow system.
- Reuse existing enums, flags, and task heading/injection patterns where possible.
- Avoid introducing new terminology if existing concepts such as `createPr` and post-task modes already cover the behavior.
- Keep the no-PR path isolated behind configuration so current default behavior is preserved.

## Additional instructions

You are working on RLF-151: Support no-PR tasks with validate-only flow.

Some tasks should complete without creating a PR or requiring an OpenSpec-based post-task flow.

Add a code-aware execution path for tasks that do not require a PR and instead use regular test execution plus a single AI validation pass.

These tasks can be administrative tasks that don't require code change

## Problem

The current loop and post-task flow assume a PR/OpenSpec-oriented completion path:

- task prompt construction can inject PR creation behavior
- post-task handling is built around PR/review-style follow-up
- archive/completion checks can depend on OpenSpec validation status

That makes simple tasks harder to run when they only need normal tests and one validation pass before either completing or being sent back for another iteration.

## Goal

Support a no-PR path where a task can:

- skip PR creation entirely
- skip OpenSpec-specific completion checks
- Skip regular tests (`test`, `lint`, `typecheck`)
- run one AI validation pass after tests succeed
- if validation fails, send the work back for another iteration using the existing task injection mechanism

## Proposed implementation

### Configuration and state

Add a workflow/config flag for this path, for example `validateOnComplete`, in the workflow schema.

Use the existing `createPr` state flag as the primary signal that the task should not create a PR, and make the new flow operate when:

- `createPr = false`
- `validateOnComplete = true`

Prefer extending existing state/config models instead of introducing a separate parallel concept for "no PR task".

### Loop and prompt behavior

Update prompt/loop setup so that when `createPr` is false, PR creation instructions are never injected into the task prompt.

The issue likely touches these areas:

- `packages/core/src/loop.ts`
- `packages/types/src/types.ts`
- `packages/workflow/src/schema.ts`
- `apps/loop/src/hooks/useLoop.ts`
- `apps/agent/src/agent/post-task.ts`

### Post-task behavior

Add a dedicated post-task branch or mode for validate-only completion.

Expected flow:

1. Worker completes its iteration.
2. Run regular checks/tests for the task.
3. If tests fail, follow the existing retry/fix path.
4. If tests pass, run a single AI validation pass.
5. If AI validation rejects the result, inject a follow-up task back into `agent-tasks.md` and continue the loop.
6. If AI validation accepts the result, allow the task to complete without PR/OpenSpec-specific handling.

This should reuse existing task injection/retry mechanisms rather than adding a separate orchestration path.

## Acceptance criteria

- Tasks can be configured to complete without creating a PR.
- When the no-PR validate-only path is enabled, PR creation instructions are not added anywhere in the task flow.
- The task runs regular tests/checks before validation.
- After tests pass, exactly one AI validation pass is executed.
- If validation fails, the system adds a new follow-up task and sends the work back for another iteration.
- If validation passes, the task can complete without OpenSpec archive/status requirements.
- Existing PR-based flows continue to behave unchanged.

## Notes for implementation

- Prefer adding this as an explicit branch in existing post-task handling rather than creating a separate flow system.
- Reuse existing enums, flags, and task heading/injection patterns where possible.
- Avoid introducing new terminology if existing concepts such as `createPr` and post-task modes already cover the behavior.
- Keep the no-PR path isolated behind configuration so current default behavior is preserved.

Labels: Feature

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

**2026-05-26 — NeriRos:** The validate should be an indicator and not a config / parameter. We have certain tasks which don't require a PR but require a validation phase specific to the task. The validation should be defined by the worker AI iteration after the design phase and executed after the implementation phase.

**Interpretation:** Remove `validateOnComplete` from `WorkflowConfigSchema` and all CLI flags. Instead, the worker AI creates `openspec/changes/<name>/specs/validate.md` during the design phase as the per-task validation indicator. The post-task handler detects this file to enter validate-only mode. When the spec file is first detected, the state is updated (`validateOnComplete = true, createPr = false`) so subsequent iterations omit PR creation instructions.
