## Guardrail: test-integrity gates — no-skip/no-only + ban mock.module(node:child_process)/jest.mock

**Gap (verified 2026-06-13):** AGENTS.md/CLAUDE.md forbid `mock.module("node:child_process", …)` and `jest.mock` (tests must patch `Bun.spawnSync` directly), but nothing enforces it — there are **33** `mock.module(...)` calls today (none yet on `node:child_process`, so a ban locks the good state). Nothing blocks a stray `test.only` (which silently hides the rest of a file's suite from CI) or net-new `test.skip`.

## Plan

1. **Lint (oxlint `no-restricted-syntax`):** error on `jest.mock(...)` and on `mock.module("node:child_process", ...)` (and `node:child_process` string arg variants). Add to `.oxlintrc.json` under the test-file override.
2. **No-only / no-skip gate** `scripts/check-test-integrity.ts`:
   - Fail on **any** `test.only` / `describe.only` / `it.only` / `.only(` in committed tests.
   - Fail on **new** `test.skip` / `describe.skip` / `test.todo` / `skipIf` / `xit` / `xdescribe` beyond a committed `scripts/.test-skip-baseline.json` allowlist (grandfather the existing handful — discover them with the grep below).
   - Wire into pre-push + CI.
3. Add `scripts/__tests__/check-test-integrity.test.ts` (a `.only` fixture fails; a baselined skip passes; a new skip fails).

Discovery for the baseline:

```bash
rg -n 'test\.skip|describe\.skip|test\.todo|skipIf|\bxit\(|\bxdescribe\(' apps packages --type ts | rg -v node_modules
```

## Acceptance criteria

- [ ] oxlint errors on `jest.mock` and `mock.module("node:child_process", …)`.
- [ ] Any `.only` fails CI; a _new_ `.skip` fails; the grandfathered skips pass.
- [ ] `bun run lint`, `bun scripts/check-test-integrity.ts`, `bun test scripts/__tests__` pass on `main`.

## Verification

```bash
bun scripts/check-test-integrity.ts; echo "exit=$?"
rg -n 'mock\.module\("node:child_process"|jest\.mock' apps packages --type ts   # expect: none
```

**Enforcement:** lint + pre-push/CI, skip-list ratchets down only. **Effort:** S–M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
