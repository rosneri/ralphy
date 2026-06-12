## Context

`@ralphy/agent-protocol` is a fully orphaned package — **zero importers** in any source file. It defines a third, drifted copy of the parent↔child agent protocol vocabulary that already lives (canonically) in `packages/engine/src/agents/protocol.ts` and `packages/types`. It survives only because the repo's hygiene tooling (knip per‑workspace‑entry, dependency‑cruiser per‑file orphan rule) is structurally blind to **whole‑package** orphans. Leaving it traps the next engineer who reaches for "the agent protocol."

Related closed RFC: #405 (hygiene).

## Current state (verified 2026-06-13)

```bash
# Zero non-test, non-dist importers of the package:
rg -l '@ralphy/agent-protocol|agent-protocol' apps packages --type ts | rg -v '/dist/|__tests__'   # → no output
```

- Package contents: `packages/agent-protocol/src/index.ts` (25 LOC) + `packages/agent-protocol/src/__tests__/`.
- Referenced only in: `tsconfig.json:45` (project reference), `knip.json:88` (workspace entry), and `bun.lock`.
- The canonical protocol lives in `packages/engine/src/agents/protocol.ts` and `packages/types/src/types.ts:429-453`.

## Scope

- **In:** delete the package and all references to it.
- **Out:** the engine/types protocol definitions (those are canonical — leave them).

## Plan

1. **Re‑confirm it is dead** (must print nothing):
   ```bash
   rg -l '@ralphy/agent-protocol|agent-protocol' apps packages --type ts | rg -v '/dist/|__tests__'
   ```
2. `rm -rf packages/agent-protocol`.
3. Remove its entry from `tsconfig.json` `references` (the `{ "path": "./packages/agent-protocol" }` line).
4. Remove its `packages/agent-protocol` block from `knip.json`.
5. Remove it from `bun.lock` by running `bun install` (regenerates the lockfile).
6. Search for any leftover references and clean them:
   ```bash
   rg -n 'agent-protocol' . --glob '!bun.lock' --glob '!**/dist/**'
   ```

## Acceptance criteria

- [ ] `packages/agent-protocol/` no longer exists.
- [ ] No reference to `agent-protocol` remains in `tsconfig.json`, `knip.json`, or any `.ts` (verified by the rg above returning nothing).
- [ ] `bun run typecheck`, `bun run check:unused` (knip), and `bun run check:deps` all pass.

## Verification (all must pass)

```bash
rg -n 'agent-protocol' . --glob '!bun.lock' --glob '!**/dist/**'   # expect: no output
bun run typecheck
bun run check:unused
bun run check:deps
```

## Risk / blast radius

**Near‑zero** — the package has no importers; deletion cannot break the build. The self‑verify grep in step 1 is the safety gate.

## Effort

**S** (≈20 min). Good first issue.

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
