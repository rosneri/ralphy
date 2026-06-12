## Guardrail: no-abbreviation identifier denylist (ratcheted)

**Gap (verified 2026-06-13):** CLAUDE.md's hard rule "never abbreviate names in code (variables, functions, files, types)" is prose only. Confirmed widespread — **233** hits of `cfg`/`tmp`/`msg`/`idx`/`acc`/`pct` in `packages/core/src` + `apps/agent/src` alone (more across the repo), plus package names `comms`, `retro`, `config` violate it.

A hard fail would block all work, so use a **ratchet**: grandfather today's identifiers, block any _new_ abbreviation.

## Plan

1. `scripts/check-no-abbreviation.ts` (Bun): scan identifiers in `packages/*/src` + `apps/*/src` (`.ts`/`.tsx`, excluding tests/`dist`). Maintain a denylist of common abbreviations with their full-word fix: `cfg→config*`, `tmp→temporary`, `msg→message`, `idx→index`, `acc→account/accumulator`, `pct→percentage`, `repo→repository`, `doc→document`, `coa→chartOfAccounts`, `fa→financialAccount`, etc.
   - Compare new/changed identifiers against `scripts/.abbreviation-baseline.json` (committed). Fail only on **new** denylisted identifiers; print the offender, file:line, and suggested full word.
   - Prefer AST identifier extraction (oxc-parser is already a dependency) over raw regex to avoid matching substrings inside legitimate words.
2. Wire into `check:structure` (warn or pre-commit-blocking) + CI.
3. `scripts/__tests__/check-no-abbreviation.test.ts`: a new `const cfg = …` fails with a `config` suggestion; a baselined identifier passes; `configuration` (contains no standalone `cfg`) passes.

## Acceptance criteria

- [ ] New denylisted abbreviations fail; the grandfathered set passes; the baseline only shrinks.
- [ ] Uses AST identifier nodes (not substring regex) — `configuration`/`accounting` are not false positives.
- [ ] Passes on `main`. `bun run typecheck`, `bun test scripts/__tests__` pass.

## Verification

```bash
bun scripts/check-no-abbreviation.ts; echo "exit=$?"   # passes (baseline grandfathers current)
```

## Notes

- This is a behavior-shaping nudge for the AI loop as much as for humans — pairs with the in-loop project-rules preamble (guardrail G7).
- Package renames (`comms`/`retro`/`config`) are out of scope here (larger, churny) — track separately if desired.

**Enforcement:** pre-commit + CI, ratcheting down. **Effort:** M. P2.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
