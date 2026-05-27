# Ralphy

Ralph loop framework.

## Stack

- Package Manager: bun - USE ONLY `bun` and `bun run` and `bunx` to run commands.
- Runtime: Bun (required, enforced via preflight at CLI entry). The project is not compatible with plain Node.js.
- Always use Bun-native APIs (`Bun.spawn` / `Bun.spawnSync`, `Bun.file`, `Bun.write`, `Bun.resolveSync`, `Bun.serve`, etc.). Only fall back to a `node:*` import if no Bun-native exists for the use case.
- Never use `node:fs` **sync** APIs in source. Callers should be async.
- Tests that need to mock spawning must patch `Bun.spawnSync` directly (see `packages/openspec/src/__tests__/openspec-change-store.test.ts` for the pattern). Do not `mock.module("node:child_process", ...)`.

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
