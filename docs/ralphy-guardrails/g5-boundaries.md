## Guardrail: real dependency-boundary enforcement + whole-package-orphan detection

**Gap (verified 2026-06-13):** All 28 projects carry `scope:*` nx tags implying a layered DAG, but **nothing reads them** — there is no `@nx/enforce-module-boundaries` and no `depConstraints`. The only enforced cross-package edge is one hand-written dependency-cruiser rule (`mcp → engine`). Meanwhile knip's per-workspace-entry model and dependency-cruiser's per-_file_ orphan rule are **blind to whole-package orphans** — which is exactly how the dead `@ralphy/agent-protocol` package (zero inbound edges) survived.

## Plan

1. **Tag-driven boundaries.** Encode the `scope:*` DAG as either `@nx/enforce-module-boundaries` `depConstraints` (in the lint config) or a tag-derived allow/deny matrix in `.dependency-cruiser.cjs`. At minimum add rules:
   - `core` (scope:shared) must not import `apps/*` or scope:cli packages (locks the currently-clean state — verified no package imports `@ralphy/agent|ui|loop|init` today).
   - no `app → app` imports.
   - confine `linear-client.ts` and `github-client.ts` so only their owning modules import them.
2. **Orphan-package detector** `scripts/check-orphan-packages.ts`: build the workspace dependency graph from each `package.json`; fail if any non-app package has **zero** inbound `dependencies`/`devDependencies` edges AND zero production importers. (This would have flagged `agent-protocol`.) Wire into `check:structure` + CI.
3. Promote dependency-cruiser `no-orphans` from `warn` → `error` with an explicit grandfather allowlist, so new orphans are blocked and known dead modules are pressured out.
4. (Optional) fan-in cap: flag any module that acquires _more_ dependents than a baseline (stops `linear-client.ts` fan-in 18 from growing).

## Acceptance criteria

- [ ] `scope:*` tags are enforced (core-no-upward, no-app-to-app, linear/github-client confinement) — adding a forbidden edge fails `bun run check:deps`.
- [ ] `scripts/check-orphan-packages.ts` flags a package with zero inbound edges; passes on the tree **after** `agent-protocol` is removed (#413).
- [ ] `no-orphans` is `error` with a documented allowlist. `bun run check:deps` + the new script pass on `main`.

## Verification

```bash
bun run check:deps
bun scripts/check-orphan-packages.ts; echo "exit=$?"
```

## Notes

- Sequence the orphan detector to land alongside or after #413 (delete `agent-protocol`), or seed its allowlist with `agent-protocol` until that lands.

**Enforcement:** CI-blocking, ratcheting. **Effort:** M–L.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail wave; complements architecture issues #412–#422. Ratcheting gates grandfather existing debt and block only new violations._
