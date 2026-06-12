## Guardrail: close the local→CI strictness gap + make required checks unbypassable

**Gap (verified 2026-06-13):** Some structural gates run **only** in the pre-commit hook (`check:structure`) and are absent from CI, so `git commit --no-verify` / `git push --no-verify` lands them on `main` unchecked. CI (`.github/workflows/ci.yml`) runs prop-drilling, hooks-location, folder-size, single-component, static-error-messages, no-unsafe-casts, duplicate-declarations, no-direct-http — but **NOT** these four that `check:structure` runs locally:

- `check-filename-case.ts`
- `check-no-reexport-tsx.ts`
- `check-test-location.ts`
- `check-tracker-seam.ts` (the RLF-230 tracker-boundary guard)

Local is stricter than CI — the exact inversion that lets boundary/dead-code regressions merge.

## Plan

1. **Single source of truth for gates.** Replace the hand-maintained list of CI steps + the `check:structure` chain with one manifest the agent reads (e.g. keep `check:structure` as the canonical aggregate and have CI run `bun run check:structure` directly, rather than re-listing individual scripts). Ensure every `scripts/check-*` runs in **both** pre-commit and CI.
2. Add a tiny `scripts/check-ci-parity.ts` (or extend the existing `check-ci-local-sync.ts`) that fails if a `scripts/check-*.ts` is referenced in `check:structure`/husky but **not** in `ci.yml` (and vice-versa) — so the two can never drift again.
3. **Branch protection as code.** Add the required-status-checks list (the CI job names) so a green check is _required_, not advisory — via `gh api` in a small `scripts/apply-branch-protection.ts` (run by a maintainer) + a drift check. Document the required checks in `CONTRIBUTING.md`.

## Acceptance criteria

- [ ] `check-filename-case`, `check-no-reexport-tsx`, `check-test-location`, `check-tracker-seam` all run in CI.
- [ ] `scripts/check-ci-parity.ts` fails if any check is in pre-commit but not CI; it passes on the fixed tree.
- [ ] Required-status-checks are recorded as code; a maintainer can apply them with one command.

## Verification

```bash
bun scripts/check-ci-parity.ts; echo "exit=$?"   # passes only when parity holds
rg -n 'check-filename-case|check-no-reexport-tsx|check-test-location|check-tracker-seam' .github/workflows/ci.yml
```

**Enforcement:** CI-blocking + branch protection. **Effort:** M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
