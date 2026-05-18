# linear-indicators — add `project` marker type

## ADDED Requirements

### Requirement: `Marker` MUST support a `project` variant

The `Marker` discriminated union in `packages/types/src/types.ts` MUST
include the variant `{ type: "project"; value: string }`, where `value`
is the Linear project name. The variant participates in the existing
`GetIndicator.filter` and `SetIndicator` mechanisms exactly like
`label`, `status`, and `attachment`.

#### Scenario: Type union accepts a project marker

- **Given** the `Marker` type from `@ralphy/types`
- **When** TypeScript compiles `const m: Marker = { type: "project", value: "Backend" }`
- **Then** the assignment type-checks
- **And** `markersOf({ type: "project", value: "Backend" })` returns
  `[{ type: "project", value: "Backend" }]`

### Requirement: CLI `--indicator` parser MUST accept type `project`

`parseIndicator` in `apps/agent/src/cli.ts` MUST accept `project` as a
valid marker type alongside `label`, `status`, and `attachment`. Empty
values MUST still be rejected with the existing `indicator value cannot
be empty` error.

#### Scenario: getTodo project indicator parses

- **When** the agent is invoked with `--indicator getTodo:project:Backend`
- **Then** `parseArgs` returns `indicators.getTodo` whose filter
  contains `{ type: "project", value: "Backend" }`

#### Scenario: setDone project indicator parses

- **When** the agent is invoked with `--indicator setDone:project:Shipped`
- **Then** `parseArgs` returns `indicators.setDone` containing
  `{ type: "project", value: "Shipped" }`

#### Scenario: Empty project value is rejected

- **When** the agent is invoked with `--indicator getTodo:project:`
- **Then** parsing throws `indicator value cannot be empty`

### Requirement: Workflow indicator schema MUST accept the project type

The workflow indicator schema MUST include `"project"` in the zod enum at `packages/workflow/src/schema.ts` so workflow YAMLs may declare project markers without schema errors.

#### Scenario: Workflow with a project indicator validates

- **Given** a workflow YAML declaring `getTodo: [{ type: project, value: Backend }]`
- **When** the workflow is parsed
- **Then** schema validation succeeds

### Requirement: `buildIssueFilter` MUST translate project markers to GraphQL

`buildIssueFilter` in `apps/agent/src/agent/linear.ts` MUST partition
project markers from `include` / `exclude` lists and emit a
`project: { name: { in: [...] } }` branch for include and a
`project: { name: { nin: [...] } }` branch for exclude. When both an
include and an exclude project constraint are present, the exclude
branch MUST be combined with the include via `where.and` so Linear does
not silently drop one (the same pattern already used for labels).

#### Scenario: Single include project marker

- **Given** `spec = { include: [{ type: "project", value: "Backend" }] }`
- **When** `buildIssueFilter(spec)` runs
- **Then** the returned object contains `project: { name: { in: ["Backend"] } }`

#### Scenario: Single exclude project marker

- **Given** `spec = { exclude: [{ type: "project", value: "Frontend" }] }`
- **When** `buildIssueFilter(spec)` runs
- **Then** the returned object contains `project: { name: { nin: ["Frontend"] } }`

#### Scenario: Mixed include + exclude project markers

- **Given** `spec = { include: [{ type: "project", value: "A" }], exclude: [{ type: "project", value: "B" }] }`
- **When** `buildIssueFilter(spec)` runs
- **Then** the returned object contains an `and` array combining the
  include and exclude project branches

### Requirement: `LinearIssue` MUST carry the issue's project

`fetchOpenIssues` and `fetchMentionScanIssues` MUST request `project { id name }`
in their GraphQL selections and surface the result on the returned
`LinearIssue` shape as `project: { id: string; name: string } | null`,
so downstream matchers can answer project predicates without a second
API call.

#### Scenario: Issue with a project surfaces it

- **Given** Linear returns an issue with `project: { id: "p1", name: "Backend" }`
- **When** `fetchOpenIssues` resolves
- **Then** the matching `LinearIssue` exposes `project.name === "Backend"`

#### Scenario: Issue with no project surfaces null

- **Given** Linear returns an issue with `project: null`
- **When** `fetchOpenIssues` resolves
- **Then** the matching `LinearIssue` exposes `project === null`

### Requirement: `issueMatchesGetIndicator` MUST honor project markers

`issueMatchesGetIndicator` MUST return `true` when any filter marker has
`type: "project"` and its `value` case-insensitively equals the issue's
`project.name`. It MUST return `false` for project markers when the
issue has no project assigned.

#### Scenario: Project name matches case-insensitively

- **Given** an issue with `project: { id: "p1", name: "Backend" }`
- **And** an indicator with filter `[{ type: "project", value: "backend" }]`
- **When** `issueMatchesGetIndicator(issue, indicator)` runs
- **Then** the result is `true`

#### Scenario: Unassigned project never matches

- **Given** an issue with `project: null`
- **And** an indicator with filter `[{ type: "project", value: "Backend" }]`
- **When** `issueMatchesGetIndicator(issue, indicator)` runs
- **Then** the result is `false`

### Requirement: `applyMarker` MUST assign the issue to the named project

`applyMarker` in `apps/agent/src/agent/wire.ts` MUST handle
`m.type === "project"` by resolving the Linear project id from
`(team key, name)` — case-insensitively — and calling the Linear
`issueUpdate` mutation with `{ projectId }`. The `(team, name) → id`
mapping MUST be cached per agent run (parallel to the existing label /
state caches). When the project name does not resolve, `applyMarker`
MUST throw a typed error analogous to the existing
`Linear status not found` branch.

#### Scenario: Set marker moves issue to project

- **Given** an issue in team `RLF`
- **And** the agent applies `{ type: "project", value: "Shipped" }`
- **And** Linear resolves `"Shipped"` to project id `p2`
- **When** `applyMarker` runs
- **Then** the agent calls `issueUpdate` with `input.projectId === "p2"`

#### Scenario: Unknown project name throws

- **Given** Linear's `projects` query returns no nodes for `"Ghost"`
- **When** `applyMarker(issue, { type: "project", value: "Ghost" })` runs
- **Then** the call throws an error whose `project` field is `"Ghost"`
  and whose `issue` field is the issue identifier

### Requirement: `removeIndicator` MUST treat project markers as no-ops

`removeIndicator` MUST skip markers with `type: "project"`, because an
issue holds at most one project at a time and "removing" a single-valued
field is meaningless. This mirrors the existing behavior for `status`.

#### Scenario: Removal of a project marker does not call Linear

- **Given** `removeIndicator(issue, { type: "project", value: "Backend" })`
- **When** the call runs
- **Then** no GraphQL mutation is issued for the project marker
