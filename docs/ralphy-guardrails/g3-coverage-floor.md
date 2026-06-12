## Guardrail: enforce the per-package coverage floor on PRs (not just tags) + bring apps/ui into the gate

**Gap (verified 2026-06-13):** Per-package `bunfig.toml` declares `coverageThreshold = { lines = 0.9, functions = 0.9 }` (e.g. `packages/types/bunfig.toml`, `packages/core/bunfig.toml`, `apps/loop/bunfig.toml`; agent at 0.9/0.75), **but the full floor only runs on tag builds**: `.github/workflows/ci.yml:88-93` gate `test:ci` and `test:coverage:ci` behind `if: startsWith(github.ref, 'refs/tags/v')`. On a normal PR only `test:affected-files:coverage:ci` runs (changed files only), so a PR can drop a whole package below 0.9 and merge green — directly against CLAUDE.md's "Never reduce the coverage threshold." Separately, `apps/ui` is excluded from every gate (`--exclude=ui`) and has no `bunfig.toml`/coverage target despite ~1932 src LOC.

## Plan

1. In `ci.yml`, add a **PR-blocking** coverage job that runs the per-project floor on affected projects on every PR (not just tags): `nx affected -t test:coverage --exclude=ui` (drop the `--exclude=ui` once step 3 lands). Keep the tag-time full run as a backstop.
2. Optionally add `scripts/check-coverage-ratchet.ts`: read measured per-package line coverage, compare to a committed `scripts/.coverage-baseline.json`, fail if any package drops below its baseline, auto-raise the baseline when it improves (monotonic — honors "only goes up").
3. Add `apps/ui/bunfig.toml` with `coverageThreshold` (start at the current measured ratio, ratchet up), add an nx `test`/`test:coverage` target to `apps/ui/project.json`, and remove `apps/ui` from the `--exclude=ui` flags in `package.json` CI scripts. Add tests for the currently-untested pure logic (e.g. `toggleSection`).

## Acceptance criteria

- [ ] A PR that lowers an affected package below its `bunfig.toml` floor **fails CI** (previously only tag builds caught it).
- [ ] `apps/ui` has a coverage threshold + test target and is no longer globally excluded.
- [ ] The (optional) ratchet baseline only ever rises. `bun run typecheck` and the new CI job pass on `main`.

## Verification

```bash
nx affected -t test:coverage --base=main        # per-project floor enforced
cat apps/ui/bunfig.toml                          # threshold present
rg -n 'exclude=ui' package.json                  # gone (or only where justified)
```

**Enforcement:** CI-blocking on PRs, ratcheting. **Effort:** M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
