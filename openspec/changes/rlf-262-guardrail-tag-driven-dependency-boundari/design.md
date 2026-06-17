# Design — RLF-262: tag-driven dependency boundaries + whole-package-orphan detector

## Goal

Make the decorative `scope:*` nx tags load-bearing and close the
whole-package-orphan blind spot, using **ratcheting** guards that lock today's
clean state and block only new violations. All guards are Bun-native check
scripts in `scripts/` (matching the existing `check:structure` family) plus two
file-level rules in `.dependency-cruiser.cjs`.

## Mechanism choice — why custom scripts, not nx/ESLint

`@nx/enforce-module-boundaries` is an **ESLint** rule. This repo lints with
**oxlint** (`package.json` → `lint: oxlint …`) and has no ESLint pipeline, so
that rule is unavailable. dependency-cruiser works on **file paths**, not on nx
tags, so encoding a tag-derived DAG there means hand-maintaining brittle path
regexes that drift from the tags. The faithful "tag-driven" approach is a small
script that reads the `scope:*` tag from each `project.json` (the single source
of truth) and the `workspace:*` edges from each `package.json`, then enforces a
DAG over scopes. New packages get constrained automatically the moment they
declare a tag. File-level rules that have nothing to do with package tags
(client confinement, file orphans) stay in dependency-cruiser, which is the
right tool for per-file checks.

## The scope DAG

Verified tags (2026-06-13): packages are `scope:shared` except `engine` and
`adapter-codex` (`scope:cli`); apps are `scope:agent|init|loop|mcp|shell|ui`.
`packages/ui-shared` has **no** `project.json` (untagged).

Layers, low → high. A project may depend only on projects of **equal or lower**
rank:

| Rank | Scope(s)                             | Members                                                        |
| ---- | ------------------------------------ | -------------------------------------------------------------- |
| 0    | `shared` (and untagged)              | all `packages/*` except engine/adapter-codex, plus `ui-shared` |
| 1    | `cli`                                | `engine`, `adapter-codex`                                      |
| 2    | `agent`, `init`, `loop`, `mcp`, `ui` | the leaf apps                                                  |
| 3    | `shell`                              | composition root (`apps/shell`)                                |

Consequences this encodes:

- No `shared`/`cli` package may import any app (rank 0/1 → rank 2/3 is upward).
- No app may import another app **except** `shell` (rank 3 may import rank 2).
  `shell → {agent, init, loop}` is allowed by rank; `agent → loop` is not.
- All leaf apps may import `cli` and `shared` (downward).

### Grandfathered edges (allowlist)

`scripts/check-tag-boundaries.ts` carries an explicit, commented allowlist of
`from → to` package-name pairs that violate the rank rule but exist on `main`:

| Edge                              | Why grandfathered                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@ralphy/core` → `@ralphy/engine` | `core` (shared) depends on engine's run primitives today. Removing requires moving code; out of scope. |

The allowlist is the **only** way an upward edge passes. Any new upward edge
fails. (`mcp → engine` is _downward_ in the rank model and thus allowed by this
script; it stays forbidden by the existing dependency-cruiser `mcp-no-engine`
rule, which is a deliberate tightening kept as-is.)

## Files to touch

| File                                                    | Change                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/workspace-graph.ts` (new)                      | Shared loader: enumerate `packages/*` + `apps/*` via `Bun.Glob`, read `project.json` (tag) + `package.json` (name + `@ralphy/*` workspace edges) with `Bun.file`. Export `loadWorkspaceGraph(root)` → `WorkspaceNode[]` and pure helpers `scopeOf(node)`, `rankOf(scope)`. |
| `scripts/check-tag-boundaries.ts` (new)                 | Export pure `findBoundaryViolations(graph, allowlist)`; `main()` loads the real graph, prints violations, `process.exit(1)` on any.                                                                                                                                        |
| `scripts/check-orphan-packages.ts` (new)                | Export pure `findOrphanPackages(graph, allowlist)` (non-app nodes with zero inbound edges, minus allowlist); `main()` wraps it.                                                                                                                                            |
| `scripts/__tests__/check-tag-boundaries.test.ts` (new)  | Unit tests over fixture graphs (pass + fail + grandfather).                                                                                                                                                                                                                |
| `scripts/__tests__/check-orphan-packages.test.ts` (new) | Unit tests over fixture graphs (orphan flagged, allowlist suppresses, app exempt).                                                                                                                                                                                         |
| `.dependency-cruiser.cjs`                               | (1) Promote `no-orphans` `warn` → `error`, add documented (empty) grandfather `pathNot` allowlist comment. (2) Add `github-client-confinement` rule.                                                                                                                       |
| `package.json`                                          | Append `&& bun scripts/check-tag-boundaries.ts && bun scripts/check-orphan-packages.ts` to `check:structure`.                                                                                                                                                              |

## Data flow

```
project.json (tags) ─┐
                     ├─► loadWorkspaceGraph(root) ─► WorkspaceNode[]  { name, dir, scope, edges[] }
package.json (deps) ─┘                                  │
                                                        ├─► findBoundaryViolations ─► upward-edge violations
                                                        └─► findOrphanPackages    ─► zero-inbound non-app packages
```

`WorkspaceNode`: `{ name: string; dir: string; scope: string; edges: string[] }`
where `edges` are the `@ralphy/*` keys from merged `dependencies` +
`devDependencies`. `scope` defaults to `"shared"` when no `project.json`/tag.

## dependency-cruiser rules

`github-client-confinement` (error):

```js
{
  name: "github-client-confinement",
  severity: "error",
  comment: "github-client.ts may only be imported from its owning github/ dir",
  from: {
    pathNot: [
      "^apps/agent/src/shared/capabilities/github/",
      "\\.test\\.ts$",
      "\\.spec\\.ts$",
    ],
  },
  to: { path: "^apps/agent/src/shared/capabilities/github/github-client\\.ts$" },
}
```

Verified importers on `main`:

- `apps/agent/src/shared/capabilities/github/identifier-strategy.ts` — inside the
  allowed dir → passes.
- `apps/agent/src/shared/capabilities/__tests__/github-client.test.ts` — **outside**
  the `github/` dir (depcruise has no global test exclusion; it scans `apps/*/src`).
  Without a test carve-out this co-located unit test would falsely fail the rule,
  so `from.pathNot` must exclude `\.test\.ts$`/`\.spec\.ts$` (mirroring the existing
  `no-orphans` rule's exclusions). With the carve-out the tree passes today.

`no-orphans`: change `severity: "warn"` → `"error"`. Keep the existing
`pathNot` test-file exclusions; add a comment documenting that new known-dead
modules may be added to `pathNot` as a grandfather list (empty today — depcruise
reports zero file orphans on `main`).

## Edge cases

- **Untagged `ui-shared`** — treated as `scope:shared` (rank 0). `agent`/`loop`
  importing it is downward → allowed. Documented in `scopeOf`.
- **App entry points have zero inbound edges** (`shell`, `ui`, `mcp`) — the
  orphan detector **exempts apps** (`apps/*`), so these never flag. Only
  non-app packages are candidates.
- **`devDependencies` count as inbound edges** for the orphan check, matching
  the issue's spec (a package depended on only in dev is not orphaned).
- **`adapter-codex`** has one inbound edge (`engine → adapter-codex`) → not an
  orphan. Confirmed.
- **Self-edges / scoped non-`@ralphy` deps** — only `@ralphy/*` workspace edges
  participate; external npm deps are ignored.
- **Path separators** — normalize `\\` → `/` (Windows safety), as the existing
  `check-tracker-seam.ts` does.
- **Test files import confined modules** — `check:deps` scans `apps/*/src` and has
  **no** global test exclusion, so the co-located `__tests__/github-client.test.ts`
  (outside `github/`) would falsely trip `github-client-confinement` unless its
  `from.pathNot` excludes `\.test\.ts$`/`\.spec\.ts$`. The carve-out is part of the
  rule (see above). Any future confinement rule must apply the same carve-out.

## Out of scope (documented follow-ups)

- **`linear-client.ts` confinement.** Fan-in is ~19 importers across
  `index.ts`, `list.ts`, `runtime/`, `features/`, `agent/wire/*`, `queue/`.
  True confinement needs a façade/refactor that is L–XL — a separate ticket.
- **Generalized fan-in cap.** A baseline-frozen dependent-count ratchet (the
  issue's optional item) is deferred; revisit after the `linear-client`
  refactor lands so the baseline is meaningful.

## Test strategy

Each script exports a **pure** function taking an in-memory graph so tests need
no filesystem. Fixtures: a clean graph (passes), a graph with a forbidden
upward edge (fails), a graph whose only violation is the grandfathered edge
(passes), an orphan graph (fails), and an orphan suppressed by allowlist
(passes). `loadWorkspaceGraph` gets one integration test asserting the real tree
loads with expected node count and that `core`'s edges include `@ralphy/engine`.
