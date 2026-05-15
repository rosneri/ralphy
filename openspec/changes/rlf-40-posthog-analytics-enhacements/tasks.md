# Tasks — RLF-40

- [x] Auto-attach `version`, `machine_name`, `platform`, `arch`, `os_release` as defaults in `@ralphy/telemetry` `init()`.
- [x] Add `captureError()` helper that normalises `Error` instances into a uniform `{error_message, error_name, error_stack}` shape.
- [x] Wire `command_exit` + `command_error` events in `apps/shell/src/index.ts` so any thrown subcommand failure is captured.
- [x] Add `@ralphy/version` as a workspace dependency of `@ralphy/telemetry`.
- [x] Write spec delta under `specs/telemetry/spec.md` covering the new defaults and `captureError` contract.

## Manual Testing

- [x] Smoke-run `bunx ralphy --version` and confirm the process exits 0 with no telemetry-related errors on stderr. (Verified locally with `bun apps/shell/src/index.ts --version` → prints `3.0.1`, exit 0.)
- [ ] Set `RALPH_POSTHOG_KEY` to a test project key, run `bunx ralphy loop --help`, and confirm in PostHog Live Events that the `command_run` event has `version`, `machine_name`, `platform`, `arch`, and `os_release` populated.
- [ ] With `RALPH_TELEMETRY=0`, run `bunx ralphy loop --help` and confirm no events appear in PostHog (opt-out still wins).
- [ ] Trigger a deliberate crash in a subcommand (e.g. invoke `loop` with a bad flag that throws after dispatch) and confirm a `command_error` event appears with `error_message`/`error_stack` filled in.
- [ ] Run the agent on a real Linear ticket end-to-end and skim PostHog: every `agent_*` event should carry the new default props.
