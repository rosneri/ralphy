# Ralphy

Ralph loop framework.

## Stack

- Package Manager: bun - USE ONLY `bun` and `bun run` and `bunx` to run commands.
- Runtime: Bun (required, enforced via preflight at CLI entry). The project is not compatible with plain Node.js.
- Always use Bun-native APIs (`Bun.spawn` / `Bun.spawnSync`, `Bun.file`, `Bun.write`, `Bun.resolveSync`, `Bun.serve`, etc.). Only fall back to a `node:*` import if no Bun-native exists for the use case.
- Never use `node:fs` **sync** APIs in source. Callers should be async.
- Tests that need to mock spawning must patch `Bun.spawnSync` directly (see `packages/openspec/src/__tests__/openspec-change-store.test.ts` for the pattern). Do not `mock.module("node:child_process", ...)`.

## Code Conventions

- Spell names out; do not abbreviate identifiers. A reader should never have to expand an acronym to understand a variable, function, or type name.
- No re-exports — do not add barrel files that re-export another module's symbols. Import each symbol from the module that defines it (enforced by `scripts/check-no-reexport-tsx.ts` in `check:structure`).
- No `any` and no unsafe casts — keep types honest (`no-explicit-any` is an oxlint error; `scripts/check-no-unsafe-casts.sh` blocks casts).
- Shared logic lives in `packages/` and is consumed by `apps/`; never reach from a package back into an app.

## State Machines

The authoritative stop and flow logic lives in XState machines — do not duplicate these guards imperatively:

- `packages/core/src/machines/flow.machine.ts` — issue lifecycle states: `idle` → `working` → `conflict-fix` / `ci-fix` / `awaiting` / `review` / `done` / `error`. Send typed events (`RESUME_DETECTED`, `CONFLICT_DETECTED`, `CI_FAILED_DETECTED`, etc.) to transition; read `actor.getSnapshot().value` only when you need to surface the state to the UI or logs.
- `packages/core/src/machines/loop.machine.ts` — loop stop-condition guards (`maxIterationsReached`, `costCapReached`, `runtimeLimitReached`, `consecutiveFailuresReached`). `loopMachine`, consumed by `createLoopRunner` (`packages/core/src/loop-runner/index.ts`), is the single per-spawn stop arbiter; there is no imperative stop re-implementation. Send iteration/cost/runtime/failure data as events and let the machine's guards decide when to stop — never re-derive a stop condition by hand.
- `packages/core/src/machines/flow-actor-store.ts` — in-memory actor registry with optional disk persistence. Call `getActor(issueId, changeDir)` to get-or-create an actor; call `persistActor` to flush state to disk. An actor is always loaded for any active worker — if `getActor` returns a missing actor, log a warning rather than falling back to stale trigger strings.

## Configuration

One config pipeline (`packages/config`): argv ⊕ WORKFLOW.md ⊕ schema defaults, merged in exactly one place with `cli > workflow > default` precedence.

- CLI parse results are SPARSE (`CliOverrides` carries only the keys the user passed). Never re-introduce pre-filled defaults into a parse result, and never write `args.x || cfg.y` / `args.x !== <default>` merge logic in app code — call `resolveConfig`/`resolveParsedConfig` at boot and read `effective`.
- Child workers receive `serializeOverrides(overrides)` plus an explicit `--workflow` path and re-resolve the same WORKFLOW.md; spawn commands never carry pre-merged effective values.
- New config keys go in the workflow Zod schema (plus an optional wizard field) and flow through automatically. Enum-backed wizard selects and the CLI option table derive from the schema (`packages/workflow/src/schema-meta/`); Zod introspection stays confined to `schema-meta/introspect.ts`.

## Change Layout

Change files are split across two directories:

- `openspec/changes/<change-name>/` — task files managed by OpenSpec:
  - `proposal.md` — description and `## Steering` section
  - `design.md` — technical design
  - `tasks.md` — checklist driving iteration
  - `specs/` — per-task specifications

- `.ralph/tasks/<change-name>/` — loop state only:
  - `.ralph-state.json` — loop state (iteration count, status, cost, history)

There are no phases. The loop reads `openspec/changes/<name>/tasks.md`, works on the first unchecked item, validates, and checks it off.

## Cost Warning

Long-running changes with unlimited iterations can burn significant API usage. Use safeguards:

- `--max-iterations N` — stop after N iterations (e.g. `ralph task --name foo --max-iterations 10`)
- `--max-cost N` — stop when total cost exceeds $N
- `--max-runtime N` — stop after N minutes of wall-clock time
- `--max-failures N` — stop after N consecutive identical failures (default: 5)

- **Never reduce the coverage threshold unless told to**

## Manual UI Testing

Use agent-browser to manually test the UI at http://localhost:1420/
