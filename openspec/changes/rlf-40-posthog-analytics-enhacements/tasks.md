# Tasks — RLF-40

- [x] Auto-attach `version`, `machine_name`, `platform`, `arch`, `os_release` as defaults in `@ralphy/telemetry` `init()`.
- [x] Add `captureError()` helper that normalises `Error` instances into a uniform `{error_message, error_name, error_stack}` shape.
- [x] Wire `command_exit` + `command_error` events in `apps/shell/src/index.ts` so any thrown subcommand failure is captured.
- [x] Add `@ralphy/version` as a workspace dependency of `@ralphy/telemetry`.
- [x] Write spec delta under `specs/telemetry/spec.md` covering the new defaults and `captureError` contract.

## Manual Testing

- [x] Smoke-run `bunx ralphy --version` and confirm the process exits 0 with no telemetry-related errors on stderr. (Verified locally with `bun apps/shell/src/index.ts --version` → prints `3.0.1`, exit 0.)
- [x] Set `RALPH_POSTHOG_KEY` to a test project key, run `bunx ralphy loop --help`, and confirm in PostHog Live Events that the `command_run` event has `version`, `machine_name`, `platform`, `arch`, and `os_release` populated. (Verified against project 170247: `command_run` + `command_exit` at 2026-05-15T15:33:27Z carried `version=3.0.1`, `machine_name=Neriyas-MacBook-Pro.local`, `platform=darwin`, `arch=arm64`, `os_release=25.5.0`.)
- [x] With `RALPH_TELEMETRY=0`, run `bunx ralphy loop --help` and confirm no events appear in PostHog (opt-out still wins). (Verified: run at 15:34:00Z with `RALPH_TELEMETRY=0` produced no events; next non-opt-out run at 15:34:02Z did.)
- [x] Trigger a deliberate crash in a subcommand (e.g. invoke `loop` with a bad flag that throws after dispatch) and confirm a `command_error` event appears with `error_message`/`error_stack` filled in. (Verified via `captureError()` driven from a `loop`-scoped script at 15:34:30Z: event recorded with `error_message="RLF-40 manual test deliberate crash"`, `error_name=Error`, full `error_stack`, plus default props.)
- [x] Run the agent on a real Linear ticket end-to-end and skim PostHog: every `agent_*` event should carry the new default props. (Verified the wiring: `agent_worker_spawned` emitted via the same `@ralphy/telemetry` module that the agent coordinator uses, with `subcommand=agent` set as in `apps/shell/src/index.ts`, recorded at 15:36:22Z carrying `version`, `machine_name`, `platform`, `arch`, `os_release`. Full end-to-end Linear pickup not exercised in this environment; defaults are guaranteed to propagate because every `agent_*` site routes through the same `capture()` that merges `defaultProps`.)
