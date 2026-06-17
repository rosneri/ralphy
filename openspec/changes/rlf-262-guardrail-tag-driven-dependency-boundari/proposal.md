# RLF-262: guardrail: tag-driven dependency boundaries + whole-package-orphan detector

Source: [RLF-262](https://linear.app/neriros/issue/RLF-262/guardrail-tag-driven-dependency-boundaries-whole-package-orphan)
Status: Todo

## Why

_Migrated from GitHub issue [rosneri/ralphy#427](https://github.com/rosneri/ralphy/issues/427). Original labels: architecture, guardrail._

All 30 workspace projects carry `scope:*` nx tags that imply a layered DAG, but
**nothing reads them** — there is no ESLint `@nx/enforce-module-boundaries`
(the repo lints with **oxlint**, which has no equivalent rule) and no
`depConstraints`. The only enforced cross-package edge is one hand-written
dependency-cruiser rule (`mcp → engine`). The tags are decorative.

Separately, both unused-code guards are **blind to whole-package orphans**:
knip checks reachability per workspace entry, and dependency-cruiser's
`no-orphans` rule is per-_file_ — a package whose own `index.ts` reaches its own
files is "reachable" even when **no other package depends on it**. That blind
spot is exactly how the dead `@ralphy/agent-protocol` package (zero inbound
workspace edges, verified 2026-06-13) survived.

### What the audit verified against `main` (2026-06-13)

Several assumptions in the original issue were **false** and the design below
corrects them:

- `@ralphy/core` (`scope:shared`) **does** depend on `@ralphy/engine`
  (`scope:cli`) today — so a blanket "shared must not import cli" rule would
  fail on `main`. This edge is grandfathered.
- `apps/shell` **does** import `@ralphy/agent`, `@ralphy/init`, and
  `@ralphy/loop` — it is the composition root. A blanket "no app → app" rule
  would fail on `main`. The DAG models `shell` as a top layer that may import
  sibling apps.
- `linear-client.ts` has a fan-in of **~19 importers** spread across the whole
  `apps/agent` tree — it **cannot** be confined to one owning module without a
  large refactor. `github-client.ts`, by contrast, has exactly **one** importer
  and is confinable today.
- dependency-cruiser reports **zero** file-level orphan warnings on `main`, so
  promoting `no-orphans` to `error` needs no grandfather entries.

## What Changes

- **Tag-driven package boundaries** — add `scripts/check-tag-boundaries.ts`, a
  Bun-native guard that reads each project's `scope:*` nx tag plus its
  `workspace:*` dependency edges and fails on any **upward** edge in the scope
  DAG (`shared` → `cli` → `apps` → `shell`). Untagged packages (e.g.
  `ui-shared`) are treated as `shared`. A small, documented grandfather
  allowlist holds the one known-debt edge (`@ralphy/core → @ralphy/engine`).
  This locks the currently-clean state: no package may import an app, and no app
  may import another app except the `shell` composition root.
- **Whole-package-orphan detector** — add `scripts/check-orphan-packages.ts`
  that builds the workspace graph and fails if any **non-app** package has zero
  inbound `dependencies`/`devDependencies` edges. Allowlist seeded with
  `@ralphy/agent-protocol` (removed once #413 lands).
- **Shared graph helper** — add `scripts/workspace-graph.ts` (load project.json
  tags + package.json workspace edges into one graph), consumed by both scripts
  and unit-tested.
- **`github-client.ts` confinement** — add a dependency-cruiser rule so only its
  owning `apps/agent/src/shared/capabilities/github/` directory may import it.
- **`no-orphans` → `error`** in `.dependency-cruiser.cjs`, with a documented
  (currently empty) grandfather allowlist for future-proofing.
- **Wiring** — append both new scripts to the `check:structure` npm script so
  they run locally and in CI.
- **Deferred (documented, out of scope):** true confinement of `linear-client.ts`
  (needs a ~19-call-site refactor) and a generalized fan-in cap. Captured as
  follow-ups in design.md, not implemented here.

## Acceptance Criteria

- [ ] `scope:*` tags are enforced by `scripts/check-tag-boundaries.ts`: adding a
      forbidden edge (a package importing an app, or app→app outside `shell`) fails
      the script; the script passes on `main` with only the documented
      `core → engine` grandfather edge.
- [ ] `scripts/check-orphan-packages.ts` fails when a non-app package has zero
      inbound edges; it passes on `main` with `@ralphy/agent-protocol` allowlisted,
      and would flag `agent-protocol` if it were removed from the allowlist.
- [ ] `no-orphans` is `error` (not `warn`) in `.dependency-cruiser.cjs` with a
      documented allowlist; `bun run check:deps` passes on `main`.
- [ ] `github-client.ts` may only be imported from its owning `github/`
      directory; an import from elsewhere fails `bun run check:deps`.
- [ ] Both new scripts are wired into `check:structure`; `bun run check:structure`,
      `bun run check:deps`, `bun run lint`, and `bun run test` pass on `main`.
- [ ] Each new script has a co-located unit test under `scripts/__tests__/`
      exercising a passing and a failing fixture graph.

## Verification

```bash
bun run check:deps
bun scripts/check-tag-boundaries.ts;  echo "exit=$?"
bun scripts/check-orphan-packages.ts; echo "exit=$?"
bun run check:structure
bun test scripts/__tests__
```

## Notes

- Sequence the orphan detector to land alongside or after #413 (delete
  `agent-protocol`); until then its allowlist carries `@ralphy/agent-protocol`.
- **Enforcement:** CI-blocking, ratcheting — grandfather lists capture existing
  debt and block only new violations. **Effort:** M.

---

_Filed from a multi-agent quality audit + guardrail-design workflow (facts
verified against `main`, 2026-06-13). Part of the "raise the bar" guardrail
wave; complements architecture issues #412–#422._

## Additional instructions

You are working on RLF-262: guardrail: tag-driven dependency boundaries + whole-package-orphan detector.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
