## Context

The loop stop‑reason taxonomy is a hand‑maintained union that is bridged to the `loopMachine`'s `stopped` substate names by an **unchecked string cast**. If a machine substate is renamed/added, `stoppedStateToReason` will happily cast an unknown string to `StopReason` at runtime with no compile‑time or runtime guard. Make the tuple the single source of truth and validate at the boundary.

Related closed RFC: #401.

## Current state (verified 2026-06-13)

- Union: `packages/core/src/loop.ts:670-680`:
  ```ts
  export type StopReason =
    | "maxIterations"
    | "completed"
    | "costCap"
    | "runtimeLimit"
    | "consecutiveFailures"
    | "rateLimited"
    | "stranded";
  ```
- Unchecked cast: `packages/core/src/machines/loop.machine.ts:42-48`:
  ```ts
  export function stoppedStateToReason(snapshot: { value: unknown }): StopReason | null {
    const val = snapshot.value;
    if (typeof val === "object" && val !== null && "stopped" in val) {
      return (val as Record<string, string>).stopped as StopReason; // ← unchecked
    }
    return null;
  }
  ```
- `loop-runner/index.ts:56` extends it: `LoopRunnerStopReason = StopReason | "cancelled" | "signal" | "error"`.
- The machine's `stopped` substates (in `loop.machine.ts`) must equal the tuple members — that equality is currently only enforced by hand.

## Scope

- **In:** derive `StopReason` from a `const` tuple; validate the cast in `stoppedStateToReason` against the tuple; add a test asserting the machine's `stopped` substate names ≡ the tuple.
- **Out:** `LoopRunnerStopReason`'s extra runtime reasons (cancelled/signal/error) — leave them; they are runner‑level, not machine substates.

## Plan

1. In `packages/core/src/loop.ts`, replace the union with a tuple + derived type:
   ```ts
   export const STOP_REASONS = [
     "maxIterations",
     "completed",
     "costCap",
     "runtimeLimit",
     "consecutiveFailures",
     "rateLimited",
     "stranded",
   ] as const;
   export type StopReason = (typeof STOP_REASONS)[number];
   ```
   Keep the existing doc comment.
2. In `loop.machine.ts`, import `STOP_REASONS` and make `stoppedStateToReason` validate instead of cast:
   ```ts
   const candidate = (val as Record<string, string>).stopped;
   return (STOP_REASONS as readonly string[]).includes(candidate)
     ? (candidate as StopReason)
     : null;
   ```
3. Add a test in `packages/core/src/machines/__tests__` that introspects the `loopMachine` definition's `stopped` child‑state keys and asserts they are exactly `new Set(STOP_REASONS)` — so a future rename/add fails CI until the tuple is updated. (Use the machine config directly; no `mock.module`.)
4. `rg -n 'as StopReason'` — confirm the only remaining occurrence is the validated one (or none).

## Acceptance criteria

- [ ] `StopReason` is derived from `STOP_REASONS` (one source of truth).
- [ ] `stoppedStateToReason` returns `null` for an unknown substate instead of casting it (no unchecked `as StopReason`).
- [ ] A test fails if the machine's `stopped` substate names diverge from `STOP_REASONS`.
- [ ] `bun run typecheck` and `bun test packages/core/src` pass; coverage not reduced.

## Verification (all must pass)

```bash
rg -n 'as StopReason' packages/core/src        # expect: only the guarded line, or none
bun run typecheck
bun test packages/core/src
```

## Risk / blast radius

**Low.** Tightens an existing path; the new validation only changes behavior for an _unknown_ substate (previously a latent bug). The new equality test pins machine↔tuple alignment.

## Effort

**S–M** (≈1–1.5 h).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
