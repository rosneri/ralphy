# Tasks for RLF-93

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-93/stage-4-shared-capabilities-extraction and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

### Capability shell + types

- [x] Create `apps/agent/src/shared/capabilities/types.ts` exporting `Capability<TArgs,TResult>`, `RetryPolicy`, `ErrorFormatter`.
- [x] Create `apps/agent/src/shared/capabilities/run-capability.ts` implementing the retry loop, error formatter call, bus emission of `${name}.started|fetched|failed`, and the `required → never return on throw` invariant.
- [x] Add unit tests `apps/agent/src/shared/capabilities/__tests__/run-capability.test.ts` covering: happy-path event ordering, retry on transient failure, no `.failed` between retries, `required: true` rethrows and produces no value, `errorFormatter` is called exactly once on terminal failure.

### Bus event additions

- [x] Extend `packages/events/src/types.ts` `RalphEvent` union with capability events: `linear.*.{started,fetched,failed}`, `gh.*.{started,fetched,failed}`, `git.worktree.{created,removed,failed}`, `fs.change.{scaffolded,task.prepended,steering.appended}`, `worker.spawned`.
- [x] Update `packages/events/src/__tests__` to assert these literals are accepted by `Bus.emit`.

### PollContext move

- [x] Move `apps/agent/src/agent/poll-context/index.ts` to `apps/agent/src/shared/capabilities/poll-context.ts`; update imports across the repo.
- [x] Add tests asserting field-order-insensitive memo key, single-runner invocation, memo isolation between instances, and that a rejected fetch is dropped from memo (no permanent negative cache).

### fs-change capability

- [x] Create `apps/agent/src/shared/capabilities/fs-change.ts` exposing `scaffold`, `prependTask`, `appendSteering` as `Capability` descriptors backed by current Bun.file/Bun.write code paths.
- [x] Replace direct fs writes in `wire.ts`, `scaffold.ts`, `post-task.ts`, `linear-sync/*` with calls through this capability.
- [x] Tests for `fs-change` covering scaffold idempotency, prepend ordering (directive goes before existing first task), steering append newline behavior.

### git capability

- [x] Create `apps/agent/src/shared/capabilities/git.ts` wrapping `createWorktree`, `removeWorktree`, `seedWorktreeMcpConfig`, marked `required: true` for `createWorktree`.
- [x] Update `wire.ts` to call `runCapability(git.createWorktree, ...)` with no surrounding try/catch swallowing the throw; the only handler is the quarantine path that applies `ralph:error`.
- [x] Test that a thrown `createWorktree` never resolves to `cwd === projectRoot` and that the `ralph:error` label flow is invoked.

### gh-client capability

- [x] Create `apps/agent/src/shared/capabilities/gh-client.ts` wrapping every `gh` invocation currently in `wire.ts`, `post-task.ts`, `ci.ts`, `pr.ts`, `pr-url/`.
- [x] Implement retry on transient `gh` failures (network / 5xx) but NOT on auth errors.
- [x] `errorFormatter` includes exit code + stderr tail.
- [x] Tests with a mock `CmdRunner` covering retry, error formatting, and bus event emission.

### linear-client capability

- [x] Move `linearRequest` and every Linear op from `apps/agent/src/agent/linear.ts` into `apps/agent/src/shared/capabilities/linear-client.ts`.
- [x] Add 429 retry honoring `Retry-After` (parse seconds or HTTP-date), clamped to `MAX_RETRY_AFTER_MS = 2000`.
- [x] Update `errorFormatter` to return `status + truncated(body, 512) + graphql messages joined by '; '`.
- [x] Tests: 429 + `Retry-After: 1` → second attempt succeeds; 5xx exhaustion → formatted error; GraphQL errors surfaced; existing `linearRequestInternals.sleep` seam still works.

### worker-spawner capability + SpawnMode removal

- [x] Create `apps/agent/src/shared/capabilities/worker-spawner.ts` exposing `spawnWorker({ cwd, changeName, steeringNote?, prependTask? })`.
- [x] Delete `SpawnMode` from `apps/agent/src/queue/queue-order.ts`; add explicit `priority: number` to `QueueItem` and update sort.
- [x] Update `coordinator.ts` `ActiveWorker.mode` → drop or replace with `priority`/`trigger` enums that carry semantic intent without coupling to spawn behavior.
- [x] Update `wire.ts` `prepare(issue)` signature: no more `mode` parameter; callers needing a task prepend invoke `fsChange.prependTask` themselves first.
- [x] Update queue tests to assert ordering uses `priority` and not `SpawnMode`.
- [x] Grep test (or simple ESLint rule) asserts `SpawnMode` is not referenced anywhere.

### ESLint rule

- [x] Add `eslint.config.ts` (or equivalent) at repo root with `no-restricted-imports` rule at severity `warn` matching the patterns in design.md.
- [x] Add an `overrides` block for `**/detect.ts` banning `*linear*`, `*gh-client*`, `*git*`, and `node:child_process` imports.
- [x] Verify `bun run lint` reports the new warnings (or zero, if all already conform) without failing CI.

### Wire/coordinator cleanup

- [x] `coordinator.ts` does not import `node:child_process`, `Bun.spawn`, `gh` runners, or anything other than pure types from `./linear`. Verified via grep. (`wire.ts` retains its existing internal `Bun.spawn` calls — those flow through `git`, `gh-client`, and `worker-spawner` capability wrappers added earlier in this change; further inlining is out of scope for this stage.)
- [x] Existing characterization tests from RLF-89 (coordinator.test.ts, coordinator-restart-worker.test.ts, queue-order.test.ts) updated for the renamed `trigger` field and continue to pass.

### Final gates

- [x] `bunx openspec validate rlf-93-stage-4-shared-capabilities-extraction` passes.
- [x] `bun run lint` passes.
- [x] `bun run test` passes with coverage threshold unchanged.
- [x] Stage and commit changed files individually (no `git add -A`).
- [x] Push branch and open PR titled `rlf-93-stage-4-shared-capabilities-extraction`.
