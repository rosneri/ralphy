# Design for RLF-258 — per-file LOC budget with a grandfather baseline

## Goal

A ratcheting guardrail that caps **lines per source file**. A flat hard cap is
either impossibly strict (god-files already exist) or uselessly high, so we
grandfather today's offenders into a committed baseline and only block:

1. a **new** file over budget, or
2. a **baselined** file that **grew** past its recorded count.

Shrinking a file is always allowed and (via `--update`) ratchets the baseline
down to lock in the gain.

## Files to touch

| File                                        | Change                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/check-file-size.ts`                | **new** — guardrail script + exported pure helpers                                                    |
| `scripts/.file-size-baseline.json`          | **new (generated, committed)** — `{ "<relpath>": <lines> }` for current offenders                     |
| `scripts/__tests__/check-file-size.test.ts` | **new** — unit tests over the pure helpers                                                            |
| `package.json`                              | append `&& bun scripts/check-file-size.ts` to the `check:structure` script                            |
| `.github/workflows/ci.yml`                  | add a `Per-file LOC budget` step running `bun scripts/check-file-size.ts` next to `Folder size check` |

## Module shape

Mirror `check-tracker-seam.ts`: export pure functions so the test imports them
directly, and run `main()` only when executed as a script (guard with
`if (import.meta.main)`), so importing the module in tests has no side effects.

Exported helpers (names indicative):

- `collectSourceFiles(repoRoot): Promise<string[]>` — glob production source via
  `new Bun.Glob("**/*.{ts,tsx}")` under `packages/*/src` and `apps/*/src`,
  returning repo-relative POSIX paths, excluding tests and `dist/`.
- `countLines(text): number` — line count; pick one definition and keep it
  consistent between checking and baseline generation.
- `loadBaseline(path): Promise<Record<string, number>>` — read + parse JSON;
  return `{}` if the file is missing.
- `findViolations(sizes, baseline, maxLines): Violation[]` — pure core: for each
  file whose count `> maxLines`, flag if not in baseline OR
  `count > baseline[file]`.
- `computeUpdatedBaseline(sizes, existing, maxLines): Record<string, number>` —
  `--update` mode: include every file over budget, but for files already in the
  baseline use `min(current, existing)` so entries only ratchet **down**; drop
  entries for files that fell to/below budget.

`main()` wires these: collect → read sizes → `loadBaseline` → either print
violations and `process.exit(1)`, or (with `--update`) write the recomputed
baseline.

## Constants

- `MAX_LINES = 400`.
- Scan roots: `packages/*/src`, `apps/*/src`.
- Exclusions: `*.test.ts(x)`, `*.spec.ts(x)`, `**/__tests__/**`, `**/dist/**`,
  `**/generated/**`, `**/__fixtures__/**` (align with `check-folder-size.ts`).

## Data flow

```
glob source files ──▶ countLines per file ──▶ sizes: Record<path, lines>
                                                   │
                  scripts/.file-size-baseline.json ┤
                                                   ▼
                          findViolations(sizes, baseline, MAX_LINES)
                                   │                     │
                            (violations)            (--update)
                                   ▼                     ▼
                         print + exit 1     computeUpdatedBaseline → Bun.write
```

## Baseline file format

JSON object, keys = repo-relative POSIX paths, values = recorded line count,
sorted by key for stable diffs. Example:

```json
{
  "apps/agent/src/agent/post-task.ts": 1395,
  "apps/agent/src/runtime/coordinator.ts": 1112,
  "packages/tracker/src/linear-client.ts": 1427
}
```

Generated via `bun scripts/check-file-size.ts --update` and committed. **Never
hand-raise an entry.**

## Edge cases

- **Baseline missing** → treated as `{}`; every over-budget file is a violation.
  (Only relevant before the initial baseline is committed.)
- **File in baseline but now under budget** → not a violation; `--update` drops
  the entry so it can never silently grow back to its old size.
- **File at exactly `MAX_LINES`** → passes (`> maxLines` is strict).
- **Baselined file shrinks but stays over budget** → passes; `--update` lowers
  the entry to the new (smaller) count.
- **Path separators** → normalize to POSIX (`/`) so baseline keys are stable.
- **Counting consistency** → the same `countLines` used for both checking and
  `--update` generation, so a freshly generated baseline always passes.
- **No side effects on import** → `main()` only runs under `import.meta.main`,
  keeping the test import pure (no `Bun.spawnSync` needed for unit tests).

## Testing strategy

Unit-test the pure helpers (no real FS for the core logic), following the
`check-tracker-seam.test.ts` pattern:

- `findViolations`: new-over-budget fails; baselined-but-grew fails;
  baselined-and-shrank (still over budget) passes; under-budget passes;
  exactly-at-budget passes.
- `computeUpdatedBaseline`: ratchets down (`min`), never raises an existing
  entry, drops entries that fell to/below budget, adds new over-budget files.
- A smoke test asserting `collectSourceFiles` over the real tree returns paths
  and excludes `*.test.ts` / `__tests__/`.

## Verification

```bash
bun scripts/check-file-size.ts; echo "exit=$?"   # 0 on current tree (grandfathered)
bun test scripts/__tests__/check-file-size.test.ts
bun run typecheck && bun run lint
```
