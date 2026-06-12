## Guardrail: ban imperative `args.x || cfg.y` config merges outside the resolveConfig pipeline

**Gap (verified 2026-06-13):** The `#404` pipeline exists precisely to centralize config precedence in one pure `mergeConfig`, but `apps/agent` re-implements precedence imperatively at 11+ sites with `args.x || cfg.y` (which also mis-handles falsy `0`/`""`/`false`). Confirmed: `apps/agent/src/agent/wire.ts:117,118,120,150,457`, `index.ts:82`, `json-runner.ts:112`, `wire/spawn/worker.ts:199,433`, `wire/mention-scan.ts:112`, `components/AgentMode.tsx:561`. Nothing prevents new ones.

This guardrail enforces what issue **#421** (migrate apps/agent onto the single config pipeline) fixes — land the ratchet first so the count can only fall.

## Plan

1. `scripts/check-config-merge.ts` (Bun, AST or precise regex): flag `<ident> || <cfg-ish>.<key>` and `<ident>.<key> !== <literal-default>` patterns in `apps/*/src` and `packages/*/src`, excluding `packages/config`/`packages/cli-args` (the sanctioned merge home) and tests.
   - Compare against a committed `scripts/.config-merge-baseline.json`; fail on any **new** occurrence; allow the count to drop. Print file:line of each.
2. Wire into `check:structure` + CI. Optionally add an oxlint `no-restricted-syntax` warn rule for the same pattern.
3. `scripts/__tests__/check-config-merge.test.ts`: a new `args.foo || cfg.foo` fails; removing one passes; code inside `packages/config` is exempt.

## Acceptance criteria

- [ ] The script grandfathers the current ~11 sites and blocks any new one in pre-commit + CI.
- [ ] `packages/config` / `packages/cli-args` are exempt; a new violation in `apps/agent` fails.
- [ ] Passes on `main`; the baseline only ratchets down as #421 burns the sites down.

## Verification

```bash
bun scripts/check-config-merge.ts; echo "exit=$?"
rg -n '\|\|\s*(cfg|config)\.' apps/agent/src --type ts | rg -v '__tests__'   # tracks burndown
```

**Enforcement:** pre-commit + CI, ratcheting down. **Effort:** S–M. Pairs with #421.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
