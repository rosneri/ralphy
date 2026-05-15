# telemetry — analytics enhancements

## ADDED Requirements

### Requirement: Telemetry events MUST include environment context by default

After `init()` resolves, every subsequent `capture()` call MUST attach `version`, `machine_name`, `platform`, `arch`, and `os_release` properties to the emitted event without the caller passing them explicitly. Calls made before `init()` MUST remain no-ops.

#### Scenario: capture after init attaches version and machine_name

- **Given** `RALPH_POSTHOG_KEY` is set and `RALPH_TELEMETRY` is unset
- **When** the host calls `init()` and then `capture("test_event")`
- **Then** the event delivered to PostHog includes a `version` string and a `machine_name` string sourced from `os.hostname()`

#### Scenario: opt-out suppresses the event entirely

- **Given** `RALPH_TELEMETRY=0`
- **When** the host calls `init()` and then `capture("test_event")`
- **Then** no PostHog client is constructed and no event is delivered

### Requirement: captureError MUST normalise error metadata

The telemetry package MUST expose `captureError(event, error, properties?)` which coerces non-`Error` values via `new Error(String(value))` and emits the event with `error_message`, `error_name`, and `error_stack` fields alongside any caller-supplied `properties`.

#### Scenario: captureError records stack and message

- **Given** a thrown `Error("boom")` and a configured telemetry client
- **When** the host calls `captureError("command_error", err, { subcommand: "loop" })`
- **Then** the emitted event carries `error_message = "boom"`, `error_name = "Error"`, a non-empty `error_stack`, and `subcommand = "loop"`
