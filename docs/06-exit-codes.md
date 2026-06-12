## Context

The parent↔child worker IPC contract is encoded as magic exit codes `70` (CI failed), `71` (PR failed), `72` (no changes), and these constants are **hand‑triplicated across three packages** with no compile‑time link. Any addition/rename drifts silently. Define them once and import everywhere.

## Current state (verified 2026-06-13)

Three independent definitions:

- `packages/retro/src/disposition.ts:9-15` — `CI_FAILED_EXIT = 70`, `PR_FAILED_EXIT = 71`, `NO_CHANGES_EXIT = 72`.
- `apps/agent/src/agent/post-task.ts:23,41` — `PR_FAILED_EXIT = 71`, `export const NO_CHANGES_EXIT = 72` (and references `70`).
- `apps/loop/src/debug.ts:578-580` — bare literals `code === 70`, `code === 71`.

Dependency check (canonical home = the package all three already depend on): `packages/types`. `packages/retro`, `apps/agent`, and `apps/loop` all depend on `@ralphy/types`.

## Scope

- **In:** one canonical exit‑code map + helper in `packages/types`; repoint the three sites to it; delete the local constants/literals.
- **Out:** changing the numeric values or the disposition mapping logic (keep `disposition.ts`'s mapping; only its constants move).

## Plan

1. Add `packages/types/src/exit-codes.ts`:

   ```ts
   /** Worker process exit codes — the parent↔child IPC contract. */
   export const WORKER_EXIT_CODES = {
     ciFailed: 70,
     prFailed: 71,
     noChanges: 72,
   } as const;

   export type WorkerExitCode = (typeof WORKER_EXIT_CODES)[keyof typeof WORKER_EXIT_CODES];
   ```

   Export it from the package's public entry (the `packages/types` barrel / `index.ts`).

2. `packages/retro/src/disposition.ts`: delete the three local consts; import `WORKER_EXIT_CODES` and use `WORKER_EXIT_CODES.ciFailed` etc. Keep the disposition mapping behavior identical.
3. `apps/agent/src/agent/post-task.ts`: delete the local `PR_FAILED_EXIT`/`NO_CHANGES_EXIT`; import from `@ralphy/types`. Update the re‑export if other modules import `NO_CHANGES_EXIT` from post-task (check with `rg`), pointing them at `@ralphy/types` instead.
4. `apps/loop/src/debug.ts`: replace the bare `70`/`71` literals with `WORKER_EXIT_CODES.ciFailed`/`.prFailed`.
5. `rg -n '\b7[012]\b' apps packages --type ts | rg -v '__tests__'` — confirm no remaining magic exit‑code literals outside the canonical map (allow unrelated 70/71/72 that are not exit codes; eyeball).

## Acceptance criteria

- [ ] `WORKER_EXIT_CODES` exists once in `packages/types` and is the only definition.
- [ ] `disposition.ts`, `post-task.ts`, `debug.ts` import it; no local 70/71/72 exit‑code constants or literals remain.
- [ ] Disposition behavior unchanged (existing `packages/retro` tests still pass).
- [ ] `bun run typecheck`, `bun run check:deps`, `bun test` (retro + agent + loop) pass.

## Verification (all must pass)

```bash
rg -n 'CI_FAILED_EXIT|PR_FAILED_EXIT|NO_CHANGES_EXIT' apps packages --type ts | rg -v 'types/src/exit-codes'   # expect: import sites only, no new defs
bun run typecheck
bun run check:deps
bun test packages/retro/src apps/agent/src apps/loop/src
```

## Risk / blast radius

**Low.** Pure constant consolidation; values unchanged. Type‑check + retro disposition tests catch any miswire.

## Effort

**S–M** (≈1 h).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
