# Tasks for RLF-262

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-262/guardrail-tag-driven-dependency-boundaries-whole-package-orphan and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### Shared graph helper

- [x] Add `scripts/workspace-graph.ts` exporting `loadWorkspaceGraph(root)` that enumerates `packages/*` + `apps/*` with `Bun.Glob`, reads each `project.json` (tag) and `package.json` (name + `@ralphy/*` workspace edges from merged `dependencies`/`devDependencies`) with `Bun.file`, and returns `WorkspaceNode[]` (`{ name, dir, scope, edges }`). No `node:fs` sync.
- [x] Add pure helpers `scopeOf(node)` (defaults untagged → `"shared"`) and `rankOf(scope)` (shared=0, cli=1, leaf apps=2, shell=3) and export them for testing.

### Tag-driven boundary guard

- [x] Add `scripts/check-tag-boundaries.ts` exporting pure `findBoundaryViolations(graph, allowlist)` that flags every edge whose target rank > source rank and is not in the grandfather allowlist.
- [x] Seed the allowlist with the single documented edge `@ralphy/core → @ralphy/engine`, with an explanatory comment.
- [x] Add `main()` that loads the real graph, prints each violation (`from → to`, with scopes), prints a success line when clean, and `process.exit(1)` on any violation.

### Whole-package-orphan detector

- [x] Add `scripts/check-orphan-packages.ts` exporting pure `findOrphanPackages(graph, allowlist)` returning non-app packages with zero inbound `@ralphy/*` edges, minus the allowlist; exempt `apps/*`.
- [x] Seed the allowlist with `@ralphy/agent-protocol` (comment: remove once #413 lands).
- [x] Add `main()` that prints orphans and `process.exit(1)` on any.

### dependency-cruiser rules

- [x] In `.dependency-cruiser.cjs`, promote `no-orphans` from `severity: "warn"` to `"error"`, keeping the existing test-file `pathNot` exclusions and adding a comment documenting the (currently empty) grandfather allowlist.
- [x] Add the `github-client-confinement` error rule with `to.path` = the `github-client.ts` file and `from.pathNot` = `["^apps/agent/src/shared/capabilities/github/", "\\.test\\.ts$", "\\.spec\\.ts$"]`. The test carve-out is required: the co-located `apps/agent/src/shared/capabilities/__tests__/github-client.test.ts` lives outside the `github/` dir and depcruise scans `apps/*/src` with no global test exclusion, so without it the rule falsely fails on `main`.

### Wiring

- [x] Append `&& bun scripts/check-tag-boundaries.ts && bun scripts/check-orphan-packages.ts` to the `check:structure` script in root `package.json`.

### Tests

- [x] Add `scripts/__tests__/check-tag-boundaries.test.ts`: clean graph passes, forbidden upward edge fails, grandfathered-only graph passes, shell→app allowed, app→app rejected.
- [x] Add `scripts/__tests__/check-orphan-packages.test.ts`: orphan flagged, allowlist suppresses, app exempt; plus a `loadWorkspaceGraph` integration test asserting the real tree loads and `@ralphy/core` edges include `@ralphy/engine`.

### Gates

- [x] `bun run check:deps` passes on `main` (github-client confinement + no-orphans error).
- [x] `bun scripts/check-tag-boundaries.ts` and `bun scripts/check-orphan-packages.ts` exit 0 on `main`.
- [x] `bun run check:structure`, `bun run lint`, and `bun run test` (incl. new script tests) pass; coverage threshold unchanged.
- [x] `bunx openspec validate rlf-262-guardrail-tag-driven-dependency-boundari` passes.
