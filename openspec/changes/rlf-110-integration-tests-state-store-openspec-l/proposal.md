# RLF-110: Integration tests — state store and OpenSpec lifecycle (S5.1–S5.5, S9.1–S9.7)

## Why

The state-store and OpenSpec change-store layers lacked integration test coverage. Specifically:

- `OpenSpecChangeStore.listChanges()` had a bug: `Bun.file(changesDir).exists()` returns `false` for directories, causing the guard to bail out before `readdir` could run. The defensive `try/catch` around `readdir` already handles missing directories, making the exists-check both incorrect and redundant.
- No integration tests exercised the multi-feature ownership isolation, schema-drift tolerance, or corruption-recovery paths in the state store.
- No integration tests exercised `OpenSpecChangeStore` against varied directory layouts (missing dir, empty files, unicode names, prefix collisions, auto-creation, archive exclusion).

## What Changes

- Remove the `Bun.file(changesDir).exists()` guard from `listChanges` in `packages/openspec/src/openspec-change-store.ts`; rely solely on the existing `try/catch` around `readdir`.
- Add S5.1–S5.5 integration tests in `packages/core/src/__tests__/state-store-integration.test.ts` covering ownership isolation, schema-drift tolerance, corruption recovery, external mutation, and all-slot accumulation.
- Add S9.1–S9.7 integration tests in `packages/openspec/src/__tests__/openspec-lifecycle-integration.test.ts` covering missing dir, empty files, stub round-trips, unicode names, prefix collisions, directory auto-creation, and archive exclusion.
