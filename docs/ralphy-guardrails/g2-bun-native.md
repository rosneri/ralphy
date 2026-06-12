## Guardrail: enforce Bun-native APIs (ban node:fs \*Sync, node:fs/promises `exists`, node:crypto `createHash`)

**Gap (verified 2026-06-13):** CLAUDE.md mandates Bun-native APIs and forbids `node:fs` sync in source, but nothing enforces it. Confirmed live violations:

- `packages/context/src/context.ts:3-9` — `readFileSync`, `writeFileSync`, `existsSync`, `unlinkSync`, `renameSync`, `mkdirSync`, `readdirSync`.
- `packages/version/src/version.ts:1,28` — `readFileSync`.
- `apps/agent/src/agent/baseline/runner.ts:1,114` — `createHash("sha1")` from `node:crypto` (Bun has `Bun.CryptoHasher`).
- Deprecated `exists` from `node:fs/promises` in `packages/paths`, `apps/loop`, `apps/mcp`, `agent/worktree.ts`.

## Plan (two layers)

1. **Lint (oxlint `no-restricted-imports` / `no-restricted-syntax`)** in `.oxlintrc.json`:
   - Forbid named imports of `*Sync` from `node:fs` and `createHash` from `node:crypto`; forbid importing `exists` from `node:fs/promises`. Message points to the Bun-native equivalent (`Bun.file`/`Bun.write`/`Bun.CryptoHasher`/`Bun.file(p).exists()`).
   - Add as **warn** first (so it doesn't block on day one), backed by the ratchet baseline gate below.
2. **Ratchet baseline** `scripts/check-bun-native.ts` + `scripts/.bun-native-baseline.json`: grandfather the current ~10 violating files; fail CI/pre-commit on any **new** violation. Then convert the callers (context.ts, version.ts, baseline/runner.ts) to async Bun APIs in follow-up PRs (callers must become async — see CLAUDE.md), shrinking the baseline to zero.
3. Wire the script into `check:structure` + CI; add `scripts/__tests__` coverage.

## Acceptance criteria

- [ ] oxlint flags `*Sync`/`createHash`/`exists` imports (warn) and the ratchet script hard-blocks new violations in pre-commit + CI.
- [ ] Baseline grandfathers exactly the current violating files; adding `readFileSync` to a clean file fails.
- [ ] `bun run lint`, `bun scripts/check-bun-native.ts`, `bun test scripts/__tests__` pass on the current tree.

## Verification

```bash
bun scripts/check-bun-native.ts; echo "exit=$?"   # passes (baseline grandfathers current)
rg -n 'from "node:fs"' packages apps --type ts | rg -v '__tests__'   # tracks burndown
```

**Enforcement:** lint (warn) + pre-commit/CI ratchet. **Effort:** M. Follow-up PRs migrate the grandfathered files to async Bun APIs.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
