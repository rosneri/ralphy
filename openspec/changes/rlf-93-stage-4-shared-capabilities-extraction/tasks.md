## Manual Testing

Manual smoke tests for the shared-capabilities extraction. These complement the unit tests in `apps/agent/src/shared/capabilities/__tests__/` by exercising the wired-up agent end-to-end.

- [x] Run `bunx openspec validate shared-capabilities` and confirm the archived spec is valid.
- [x] Run `bun run lint` and confirm the new `no-restricted-imports` rule loads (zero errors; warnings are acceptable per design).
- [x] Confirm `SpawnMode` does not appear anywhere in the codebase (`rg -n "SpawnMode" apps/`).
- [x] Confirm the capability shell file exists at `apps/agent/src/shared/capabilities/run-capability.ts` and exports `runCapability`.
- [x] Confirm each extracted capability has a file under `apps/agent/src/shared/capabilities/` (fs-change, gh-client, git, linear-client, poll-context, worker-spawner).
- [x] Confirm `apps/agent/src/agent/coordinator.ts` does not import `node:child_process` or call `Bun.spawn` directly.
- [x] Confirm capability unit tests pass (`bun test apps/agent/src/shared/capabilities/__tests__`).
