# dependency-guardrails — tag-driven boundaries + whole-package-orphan detection

## ADDED Requirements

### Requirement: Scope tags SHALL enforce a layered dependency DAG

The build SHALL fail when any workspace project declares a `workspace:*` dependency on a project of a higher scope layer, except for an explicitly grandfathered edge.

Scope layers rank low → high as `shared` (rank 0, including untagged packages),
`cli` (rank 1), the leaf apps `agent`/`init`/`loop`/`mcp`/`ui` (rank 2), and
`shell` (rank 3, the composition root). A project MAY depend only on projects of
equal or lower rank. The guard reads the `scope:*` tag from each `project.json`
and the `@ralphy/*` edges from each `package.json`. A short, documented
allowlist of `from → to` package pairs (currently only `@ralphy/core →
@ralphy/engine`) is the only way an upward edge passes; any other upward edge
fails the build.

#### Scenario: a package importing an app is rejected

- **Given** a `scope:shared` package whose `package.json` adds `@ralphy/agent`
  (a rank-2 app) to its dependencies
- **When** `bun scripts/check-tag-boundaries.ts` runs
- **Then** it reports the upward edge and exits non-zero

#### Scenario: a leaf app importing another leaf app is rejected

- **Given** `apps/agent` declaring a dependency on `@ralphy/loop`
- **When** the boundary guard runs
- **Then** it reports `agent → loop` as a forbidden app-to-app edge and exits
  non-zero

#### Scenario: the shell composition root may import sibling apps

- **Given** `apps/shell` depending on `@ralphy/agent`, `@ralphy/init`, and
  `@ralphy/loop`
- **When** the boundary guard runs
- **Then** no violation is reported for those edges

#### Scenario: the grandfathered core → engine edge passes

- **Given** the workspace on `main`, where `@ralphy/core` (shared) depends on
  `@ralphy/engine` (cli) and that pair is on the allowlist
- **When** the boundary guard runs
- **Then** it exits zero with no violations

### Requirement: Whole-package orphans SHALL be detected

The build SHALL fail when any non-app workspace package has zero inbound `dependencies`/`devDependencies` edges from other workspace projects, unless that package is on a documented allowlist.

App projects (`apps/*`) are exempt because they are entry points and legitimately
have zero inbound edges. The allowlist is seeded with `@ralphy/agent-protocol`
until issue #413 deletes that package.

#### Scenario: an orphan package is flagged

- **Given** a non-app package with no other project depending on it and not on
  the allowlist
- **When** `bun scripts/check-orphan-packages.ts` runs
- **Then** it reports the package as a whole-package orphan and exits non-zero

#### Scenario: app entry points are not flagged

- **Given** `apps/shell`, `apps/ui`, and `apps/mcp`, which have zero inbound
  edges
- **When** the orphan detector runs
- **Then** none of them is reported as an orphan

#### Scenario: the allowlisted agent-protocol passes on main

- **Given** the workspace on `main` with `@ralphy/agent-protocol` on the
  allowlist
- **When** the orphan detector runs
- **Then** it exits zero

### Requirement: File-level orphans and github-client imports SHALL be enforced via dependency-cruiser

The `no-orphans` dependency-cruiser rule SHALL have severity `error`, and `github-client.ts` SHALL be importable only from its owning `github/` directory.

`no-orphans` is promoted from `warn` to `error` with a documented (currently
empty) grandfather allowlist. A new `github-client-confinement` rule forbids any
file outside `apps/agent/src/shared/capabilities/github/` from importing
`github-client.ts`.

#### Scenario: importing github-client from outside its directory fails

- **Given** a file outside `apps/agent/src/shared/capabilities/github/` that
  imports `github-client.ts`
- **When** `bun run check:deps` runs
- **Then** the `github-client-confinement` rule reports an error and the command
  exits non-zero

#### Scenario: the clean main tree passes check:deps

- **Given** the workspace on `main`, where the only github-client importer is
  inside the `github/` directory and there are no file-level orphans
- **When** `bun run check:deps` runs
- **Then** it exits zero
