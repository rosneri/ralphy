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

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
