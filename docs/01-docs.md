## Context

The `#401` (Single loop authority) migration **shipped**: the imperative `checkStopCondition` stop‑wrapper was deleted and `loopMachine` (consumed by `createLoopRunner`) is now the sole stop arbiter. But the authoritative docs were never updated, so they describe a system that no longer exists. Because `CLAUDE.md` is an instruction‑overriding project doc, this actively misleads both humans and AI agents (it is the root of the recurring "is the loop migration half‑done?" confusion).

Closed RFC for reference: #401.

## Current state (verified 2026-06-13)

- `CLAUDE.md` still says: _"imperative wrappers in `loop.ts` (`checkStopCondition`) are still used by older callers but should not be duplicated for new code."_
- `OPENSPEC_MIGRATION_PLAN.md` still says: _"`checkStopCondition` stays (cost / runtime / iterations / consecutive failures)."_
- The symbol does not exist anywhere in source:

```bash
rg -n 'checkStopCondition' --type ts        # → ZERO matches (only docs mention it)
rg -n 'checkStopCondition'                  # → only CLAUDE.md and OPENSPEC_MIGRATION_PLAN.md
```

- The real stop arbiter: `packages/core/src/loop-runner/index.ts` derives the stop reason exclusively via `stoppedStateToReason(actor.getSnapshot())` (loopMachine guards). `packages/core/src/loop.ts:665-668` already documents this correctly.
- `loop.ts` does still contain `checkStopSignal` (the operator STOP‑file check) — that is a **different** concept; do not touch it.

## Scope

- **In:** `CLAUDE.md`, `OPENSPEC_MIGRATION_PLAN.md` text only.
- **Out:** any code change; the `ARCHITECTURE.md` router‑table drift (tracked separately in the dead‑dispatch deletion issue).

## Plan

1. In `CLAUDE.md`, in the State Machines section: delete the sentence naming `checkStopCondition` as a live wrapper. Replace with: `loopMachine` is the single per‑spawn stop arbiter; it is consumed by `createLoopRunner` (`packages/core/src/loop-runner/index.ts`); there is no imperative stop re‑implementation. (Note: the agent layers a separate _respawn_ tier on top of one spawn — that is a distinct authority, not the loop's stop logic.)
2. In `OPENSPEC_MIGRATION_PLAN.md:156`, delete the `checkStopCondition` stays line (or mark it ✅ done — the arithmetic now lives only in `loopMachine` guards).
3. Skim both files for any other `checkStopCondition` / "dual loop" / "two loops" framing and correct it.

## Acceptance criteria

- [ ] `rg -n 'checkStopCondition'` returns **zero** matches across the whole repo.
- [ ] `CLAUDE.md` names `loopMachine` (via `createLoopRunner`) as the sole stop arbiter and contains no claim that an imperative stop wrapper is "still used".
- [ ] No source files changed (`git diff --name-only` lists only the two markdown files).

## Verification (all must pass)

```bash
rg -n 'checkStopCondition'           # expect: no output
git diff --name-only                 # expect: CLAUDE.md, OPENSPEC_MIGRATION_PLAN.md only
```

## Risk / blast radius

**None** — documentation only.

## Effort

**S** (≈15 min). Good first issue.

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
