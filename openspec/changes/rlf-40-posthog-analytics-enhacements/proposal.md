# RLF-40: Posthog Analytics Enhancements

Source: [RLF-40](https://linear.app/neriros/issue/RLF-40/posthog-analytics-enhacements)
Status: In Progress
Assignee: Neriya Rosner

## Why

PostHog telemetry today is patchy:

- Many code paths (especially error paths) don't emit events at all, so we can't
  tell from product analytics how often things fail or what users do after an
  install.
- Events that _are_ emitted don't carry the running ralphy version, so we can't
  correlate behavior or regressions to releases.
- We don't know which machine an event came from, which makes it impossible to
  group events by host when triaging.

## What Changes

- **Auto-attach environment context.** `@ralphy/telemetry`'s `init()` now seeds
  `defaultProps` with `version`, `machine_name`, `platform`, `arch`, and
  `os_release` so every subsequent `capture()` call carries them — no per–call
  bookkeeping required.
- **Uniform error events.** New `captureError(event, error, props?)` helper in
  `@ralphy/telemetry` wraps `Error` instances into a consistent
  `{error_message, error_name, error_stack}` shape.
- **Shell-level coverage.** `apps/shell/src/index.ts` now emits `command_exit`
  on normal exit and `command_error` (via `captureError`) on a thrown failure,
  so any uncaught crash inside `loop` or `agent` produces a PostHog event.
- **Spec delta** captures the new contract for the telemetry package.

## Acceptance Criteria

- Every event captured via `@ralphy/telemetry` after `init()` includes
  `version` and `machine_name`.
- A thrown error from a subcommand produces a `command_error` event.
- `bunx openspec validate rlf-40-posthog-analytics-enhacements` passes.
- `bun run test` for the telemetry package passes.

## Steering

_Add steering notes here as the loop runs._
