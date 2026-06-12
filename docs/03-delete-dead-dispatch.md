## Context

`apps/agent` shipped a clean, table‑driven dispatch pipeline (`runtime/router.ts` + `runtime/poll.ts` + `runtime/flow-runner.ts`) as the _target_ design, but the live orchestrator (`AgentCoordinator`) routes imperatively and **never wired it in**. The result is a tested‑but‑dead decoy: the published 13‑row `ROUTER_TABLE` documents a precedence the runtime ignores, and `route()` / generic `pollOnce()` / `preempt()` / `requiresWorker()` have no production callers. This actively misleads readers (it looks authoritative because CI gates the generated `ARCHITECTURE.md`).

Related closed RFC: #402.

## Current state (verified 2026-06-13)

The **live** coordinator is fully separate — do **not** touch it. `apps/agent/src/runtime/coordinator.ts` has its **own** `pollOnce()` method and its own `preemption` actor; it does not import `router.ts`/`poll.ts`/`flow-runner.ts`. `apps/agent/src/agent/json-runner.ts:223` calls `coord.pollOnce()` (the coordinator method), not the dead generic.

The dead files and their only consumers:

```bash
rg -l "runtime/router|runtime/poll|runtime/flow-runner" apps/agent/src --type ts | rg -v '/dist/'
# router.ts  → imported by poll.ts (dead) and scripts/generate-architecture.ts (ROUTER_TABLE only)
# poll.ts    → imported by its own test only
# flow-runner.ts → imported by 2 test files only
```

- `runtime/router.ts` exports `ROUTER_TABLE` + `route()`.
- `runtime/poll.ts` exports generic `pollOnce<I,C>()`.
- `runtime/flow-runner.ts` exports `requiresWorker()`, `preempt()`, type `FlowWorker`.
- `apps/agent/src/scripts/generate-architecture.ts:12` imports `ROUTER_TABLE` and renders the "Router precedence" section of `ARCHITECTURE.md`. It also imports `registry` (line 11) — **keep that**; only the router‑table part goes.

## Scope

- **In:** delete `runtime/router.ts`, `runtime/poll.ts`, `runtime/flow-runner.ts` and their test files; remove the router‑table section from the doc generator; regenerate `ARCHITECTURE.md`. Remove any now‑orphaned types in `runtime/types.ts` that were only referenced by these files (e.g. `RouterRow`, `RouterSignals`, `FlowAssignment`) — verify each with rg before deleting.
- **Out:** the live `AgentCoordinator` (`runtime/coordinator.ts`), the feature `registry`, and the `features/` slices. (The registry's own hollowness is a separate, larger issue — do not start it here.)

## Plan

1. **Re‑confirm dead** (each must show only test files + the doc generator):
   ```bash
   rg -n '\broute\(|\brequiresWorker\b|from .*runtime/(router|poll|flow-runner)' apps/agent/src --type ts | rg -v '__tests__'
   ```
   Expected non‑test hits: only `generate-architecture.ts` importing `ROUTER_TABLE`. If anything else appears, **stop** and report.
2. Edit `apps/agent/src/scripts/generate-architecture.ts`: remove `import { ROUTER_TABLE } from "../runtime/router"` and the block that builds the "## Router precedence" rows/section. Keep the registry/features section intact.
3. `rm` the three source files and their tests:
   - `apps/agent/src/runtime/router.ts`
   - `apps/agent/src/runtime/poll.ts` (+ `apps/agent/src/runtime/__tests__/poll.test.ts`)
   - `apps/agent/src/runtime/flow-runner.ts` (+ `apps/agent/src/runtime/__tests__/flow-runner-preempt.test.ts`, `awaiting-ci-no-worker.test.ts` — check whether the latter tests only flow-runner; if it also tests live code, keep it and excise only the dead imports)
4. Remove now‑orphaned types from `runtime/types.ts` only if `rg` confirms zero remaining references.
5. Regenerate the architecture doc: `bun run build:architecture`. Commit the updated `ARCHITECTURE.md`.

## Acceptance criteria

- [ ] `router.ts`, `poll.ts`, `flow-runner.ts` and their dead tests are gone.
- [ ] `ARCHITECTURE.md` no longer contains a "Router precedence" table; the Features section is unchanged.
- [ ] `rg -n 'ROUTER_TABLE|\bpollOnce<|\brequiresWorker\b'` returns no source hits (coordinator's `pollOnce()` method has no `<` generic, so it won't match `pollOnce<`).
- [ ] `bun run typecheck`, `bun run check:deps`, `bun run check:unused`, and `bun run check:state-diagrams:ci` all pass; `bun test apps/agent/src` is green.

## Verification (all must pass)

```bash
rg -n 'runtime/(router|poll|flow-runner)' apps/agent/src --type ts | rg -v '/dist/'   # expect: no output
bun run build:architecture && git diff --stat ARCHITECTURE.md
bun run typecheck
bun run check:deps
bun run check:unused
bun test apps/agent/src
```

## Risk / blast radius

**Low.** The only cross‑file coupling is the doc generator (handled in step 2). The live coordinator is independent (verified). Step 1's gate prevents deleting anything still referenced.

## Effort

**M** (≈1–2 h).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
