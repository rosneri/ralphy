# Tasks for RLF-108

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-108/mock-provider-harness-for-rlf-106-integratione2e-tests and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Create `apps/agent/test/harness/` with placeholder `index.ts` and `types.ts` (shared `HarnessCtx`, `ScenarioStep`, `LinearClientLike` types). Verify the path is reachable from `apps/agent/src/__tests__` via relative import (`../../test/harness`).
- [x] Implement `apps/agent/test/harness/clock.ts` exposing `createVirtualClock(start)` with `now()`, `advance(ms)`, and `tick()` (microtask drain). Add `apps/agent/test/harness/__tests__/clock.test.ts` covering: monotonic now, advance steps, and tick draining a pending `Promise.resolve().then(...)`.
- [x] Implement `apps/agent/test/harness/tmp-fs.ts` exposing `createTmpFs()` with `ralphRoot`, `openspecRoot`, `seedTasks`, `seedProposal`, `seedDesign`, `mutateState`, `cleanup`. Use Bun-native APIs (`Bun.write`) plus async `node:fs/promises` only — no `node:fs` sync APIs. Add `tmp-fs.test.ts` covering seed + mutate + cleanup.
- [x] Implement `apps/agent/test/harness/tmp-repo.ts` exposing `createTmpRepo()` with `dir`, `seedCommit`, `forcePushBase`, `makeConflict`, `cleanup`. Drive git via `Bun.spawn`. Add `tmp-repo.test.ts` covering seed commits and a conflict scenario.
- [x] Implement `apps/agent/test/harness/fake-linear.ts` with `createFakeLinear()` returning the `FakeLinear` interface from `design.md` (client + seed/mutation/inspection helpers + `applied` indicator log). Add `fake-linear.test.ts` exercising fetch filtering by marker (todo/in-progress/conflicted/review), comment push, mention push, and `applyIndicator`/`removeIndicator` round-trips.
- [x] Implement `apps/agent/test/harness/fake-gh.ts` returning a `CmdRunner` that scripts `gh pr create`, `gh pr view --json …`, `gh pr edit --base`, `gh pr close`, `gh pr merge`, `gh api`. Add `fake-gh.test.ts` covering each argv shape and a "no rule" failure mode.
- [x] Implement `apps/agent/test/harness/scripted-engine.ts` with `createScriptedEngine({scenario})` returning an `EngineLike` that yields turns from a `ScenarioStep[]` transcript and throws on unscripted calls. Add `scripted-engine.test.ts` covering happy path, transcript exhaustion, and unscripted-call failure.
- [x] Implement `apps/agent/test/harness/scenarios/` with a `registry` map and one scenario (`s1-1-fresh-todo.ts`) that seeds a single fresh-todo issue and a 1-diff-exit-0 transcript.
- [x] Implement `createHarness()` in `apps/agent/test/harness/index.ts` that composes the fakes, builds a `CoordinatorDeps`-shaped `coordDeps`, a `spawnWorker` driven in-process by `scripted-engine`, `runWorkerToCompletion()`, and `cleanup()`. Re-export the public surface from the barrel.
- [x] Write the end-to-end smoke test at `apps/agent/src/__tests__/harness-smoke.test.ts`: boot harness with `scenario: "s1.1-fresh-todo"`, drive `pollOnce` + `runWorkerToCompletion`, assert `setInProgress` → `setDone` ordering, PR URL recorded, and that no real `gh`/`git`/Linear network call escaped (assert via the runner/linear-fake call logs).
- [x] Write `apps/agent/test/harness/README.md` documenting: directory layout, `createHarness()` entry point, how to author a new scenario (registry entry + transcript shape), and the determinism contract (no real clock, no real network, real git only in tmpdir).
- [x] Run `bun run --filter @ralphy/agent test` from the repo root and make it green. Address any flakes; do not lower coverage thresholds.
- [x] Run `bun run lint` from the repo root and address every warning/error in the new files.
- [x] Run `bunx openspec validate rlf-108-mock-provider-harness-for-rlf-106-integr` and address any reported issues.
- [x] Stage every new/changed file with explicit `git add <path>` (never `git add -A`), commit with a descriptive message, push the branch, and open the PR per the wrapper instructions.

## Manual Testing

- [x] Run `cd apps/agent && bun test` and confirm the full suite (including harness unit tests and `harness-smoke.test.ts`) passes with 0 failures.
- [x] Run only the harness smoke test (`cd apps/agent && bun test src/__tests__/harness-smoke.test.ts`) and verify `setInProgress` → `setDone` ordering and PR URL assertions hold.
- [x] Run the harness sub-tests in isolation (`cd apps/agent && bun test test/harness/__tests__/`) and confirm clock, tmp-fs, tmp-repo, fake-linear, fake-gh, and scripted-engine specs all pass.
- [x] Inspect the specific harness errors flagged by CI (scripted-engine.ts:23, fake-linear.ts:170/175, fake-gh.ts:45, tmp-repo.ts:31) and confirm each is now a static string with dynamic context moved to `cause` (matches commit d98931a).
- [x] Verify the unscripted-step error path via `bun test test/harness/__tests__/scripted-engine.test.ts` (covers happy path, transcript exhaustion, and unscripted-call failure surfacing "missing step" with the index in `cause`).
- [x] Confirm no harness file is imported from production source: grep `apps/(agent|cli)/src` for `test/harness` and confirm zero matches.
