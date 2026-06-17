# RLF-258: guardrail: per-file LOC budget with grandfather baseline

Source: [RLF-258](https://linear.app/neriros/issue/RLF-258/guardrail-per-file-loc-budget-with-grandfather-baseline)
Status: Todo

## Why

_Migrated from GitHub issue [rosneri/ralphy#423](https://github.com/rosneri/ralphy/issues/423). Original labels: tech-debt, guardrail._

## Guardrail: per-file LOC budget with a grandfather baseline

**Gap (verified 2026-06-13):** `scripts/check-folder-size.ts` caps the _number of files per directory_ but nothing caps _lines per file_, so god-files pass freely: `linear-client.ts` 1427, `post-task.ts` 1395, `coordinator.ts` 1112, `worker-pool.ts` 792, `spec-attachments.ts` 791, `render-pdf.ts` 666. A hard cap would be either impossibly strict or uselessly high, so use a **ratchet**: record today's offenders in a committed baseline, block any _new_ file over budget and any baselined file that _grows_, allow shrinking.

## Plan

1. Add `scripts/check-file-size.ts` (Bun style, mirror an existing `scripts/check-*.ts`):
   - Glob `packages/*/src/**/*.{ts,tsx}` + `apps/*/src/**/*.{ts,tsx}`, excluding `*.test.ts`, `*.spec.ts`, `/dist/`.
   - Budget e.g. `MAX_LINES = 400`. For each file over budget, compare against `scripts/.file-size-baseline.json` (committed): fail if the file is **not** in the baseline, or is in it but **larger** than its recorded count. Print offender + line counts. Update-baseline mode (`--update`) lowers recorded counts only.
   - Exit non-zero on violation.
2. Generate the initial baseline (`bun scripts/check-file-size.ts --update`) and commit `scripts/.file-size-baseline.json`.
3. Wire into `package.json` `check:structure` and add a CI step in `.github/workflows/ci.yml`.
4. Add `scripts/__tests__/check-file-size.test.ts` covering: new-over-budget fails, baselined-but-grew fails, baselined-and-shrank passes, under-budget passes.

## Acceptance criteria

- [ ] `scripts/check-file-size.ts` + committed baseline exist; `check:structure` and CI both run it.
- [ ] A new 401-line source file fails; shrinking a baselined file passes; the baseline only ratchets down.
- [ ] Tests cover all four cases. `bun run typecheck`, `bun run lint`, `bun test scripts/__tests__` pass.

## Verification

```bash
bun scripts/check-file-size.ts; echo "exit=$?"     # passes on current tree (baseline grandfathers offenders)
bun test scripts/__tests__/check-file-size.test.ts
```

## Notes

- Pairs with the post-task / linear-client decomposition issues — as those shrink, the baseline ratchets down and locks the gain.
- **Never raise** a baseline entry by hand.

**Enforcement:** pre-commit + CI, ratcheting. **Effort:** M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against_ `main`_, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._

## What Changes

- Add `scripts/check-file-size.ts` — a ratcheting per-file LOC guardrail that globs production source under `packages/*/src/**/*.{ts,tsx}` + `apps/*/src/**/*.{ts,tsx}` (excluding `*.test.ts`, `*.spec.ts`, `__tests__/`, `dist/`), counts lines per file, and fails when a file over `MAX_LINES` (400) is **not** in the committed baseline or has **grown** beyond its recorded count. Shrinking is always allowed.
- The script exports pure, testable helpers (mirroring `check-tracker-seam.ts`): file collection, line counting, baseline load/compare, and a `--update` mode that writes/lowers baseline entries only (never raises).
- Generate and commit the initial baseline `scripts/.file-size-baseline.json` grandfathering today's offenders so the current tree passes.
- Wire the check into `package.json`'s `check:structure` script and add a CI step in `.github/workflows/ci.yml` alongside the other structure checks.
- Add `scripts/__tests__/check-file-size.test.ts` covering: new-over-budget fails, baselined-but-grew fails, baselined-and-shrank passes, under-budget passes, and `--update` ratchets down only.

## Acceptance Criteria

- [ ] `scripts/check-file-size.ts` + committed `scripts/.file-size-baseline.json` exist; both `check:structure` and CI run the check.
- [ ] A new 401-line source file fails; a file growing past its baseline fails; shrinking a baselined file passes; under-budget files pass.
- [ ] `--update` only lowers (ratchets down) recorded counts and never raises an existing entry.
- [ ] Running `bun scripts/check-file-size.ts` on the current tree exits 0 (offenders grandfathered).
- [ ] Tests cover all four core cases plus the ratchet-down behavior; `bun run typecheck`, `bun run lint`, and `bun test scripts/__tests__` pass.

## Additional instructions

You are working on RLF-258: guardrail: per-file LOC budget with grandfather baseline.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
