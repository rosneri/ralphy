# Tasks for RLF-258

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-258/guardrail-per-file-loc-budget-with-grandfather-baseline and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### Script

- [x] Add `scripts/check-file-size.ts` (Bun style, `#!/usr/bin/env bun`) with `MAX_LINES = 400`, scanning `packages/*/src` and `apps/*/src` for `**/*.{ts,tsx}` via `new Bun.Glob`, excluding `*.test.ts(x)`, `*.spec.ts(x)`, `__tests__/`, `dist/`, `generated/`, `__fixtures__/`.
- [x] Export pure helpers: `collectSourceFiles(repoRoot)`, `countLines(text)`, `loadBaseline(path)`, `findViolations(sizes, baseline, maxLines)`, `computeUpdatedBaseline(sizes, existing, maxLines)`. Normalize paths to POSIX.
- [x] Implement `main()` guarded by `if (import.meta.main)`: collect → count → load baseline → print violations + `process.exit(1)`, or under `--update` write the recomputed baseline (sorted keys, trailing newline) via `Bun.write`.
- [x] Ensure `computeUpdatedBaseline` ratchets down only (`min(current, existing)`), adds new over-budget files, and drops files at/under budget.

### Baseline

- [x] Generate the initial baseline: `bun scripts/check-file-size.ts --update`, then commit `scripts/.file-size-baseline.json`.
- [x] Verify `bun scripts/check-file-size.ts` exits 0 on the unmodified tree (offenders grandfathered).

### Wiring

- [x] Append `&& bun scripts/check-file-size.ts` to the `check:structure` script in `package.json`.
- [x] Add a `Per-file LOC budget` step running `bun scripts/check-file-size.ts` in `.github/workflows/ci.yml`, adjacent to the `Folder size check` step.

### Tests

- [x] Add `scripts/__tests__/check-file-size.test.ts` importing the pure helpers (mirroring `check-tracker-seam.test.ts`).
- [x] Cover `findViolations`: new-over-budget fails, baselined-but-grew fails, baselined-and-shrank passes, under-budget passes, exactly-at-budget passes.
- [x] Cover `computeUpdatedBaseline`: lowers a shrunk entry, never raises a grown entry, drops a file that fell under budget, adds a new over-budget file.
- [x] Add a smoke test that `collectSourceFiles` over the real tree returns paths and excludes `*.test.ts` / `__tests__/`.

### Gates

- [x] `bun run typecheck` passes.
- [x] `bun run lint` passes.
- [x] `bun test scripts/__tests__` passes.
- [x] `bun run check:structure` passes (includes the new check).
