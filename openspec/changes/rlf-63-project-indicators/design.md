# Design for RLF-63 — Project Indicators

## Goal

Extend the existing `linear.indicators` mechanism with a `project`
marker type so operators can filter pickup by Linear Project and move
issues between projects as a lifecycle signal.

## Files touched

- `packages/types/src/types.ts`
  - Extend the `Marker` union with `| { type: "project"; value: string }`.
  - Document the semantics in the file-level comment so consumers know
    `value` is the Linear `Project.name` (case-insensitive).
- `packages/workflow/src/schema.ts`
  - Extend `MarkerSchema.type` enum with `"project"`.
  - Keep the `superRefine` on `IndicatorsSchema` rejecting any non-label
    marker in `clearConflicted` / `clearReview`. Update the error
    message to "markers must be label-typed" so `project` and other
    new marker types reuse the same guard.
- `packages/workflow/src/default.ts`
  - Add a commented example showing how to scope `getTodo` to a Linear
    project, and how to `setInProgress` a project assignment.
- `apps/agent/src/agent/linear.ts`
  - Extend `LinearIssue` and `LinearNode` with `project: { id, name } | null`.
  - Request `project { id name }` in `fetchOpenIssues` and
    `fetchMentionScanIssues` GraphQL queries; map into the typed shape.
  - Extend `partition()` to collect a `projects: string[]` bucket.
  - Extend `buildIssueFilter()` to translate project include/exclude
    into `project: { name: { in / nin: [...] } }` clauses, merging
    through `and:` exactly like the existing label/state handling.
  - Extend `issueMatchesGetIndicator()` to handle the `project` arm by
    comparing `issue.project?.name.toLowerCase()`.
  - New `fetchProjectIdByName(apiKey, name)` → `string | null`. GraphQL:
    `projects(filter: { name: { eq: $name } }, first: 1)`.
  - New `setIssueProject(apiKey, issueId, projectId)` →
    `issueUpdate(input: { projectId })`.
- `packages/workflow/src/__tests__/workflow.test.ts`
  - Add a test that parses an indicator block with a `project` marker
    and asserts the round-trip.
  - Add a test that asserts `clearConflicted` rejects `project` markers
    with the label-only message.
- `apps/agent/src/__tests__/linear-project-indicator.test.ts` (new)
  - Unit-test `issueMatchesGetIndicator` for the project arm
    (case-insensitive, null-project behaviour).
  - Unit-test `buildIssueFilter` for include + exclude project clauses
    (assert the emitted GraphQL object shape).

## Data flow

1. `parseWorkflow` reads `WORKFLOW.md`, validates via Zod, exposes
   `config.linear.indicators.*` with the new `project` marker variant.
2. On agent start, `fetchOpenIssues(apiKey, spec)` builds an
   `IssueFilter` via `buildIssueFilter()`. Project markers in
   `spec.include` become `project: { name: { in: [...] } }`; exclude
   markers become an `and:`-merged `project: { name: { nin: [...] } }`.
3. Returned `LinearIssue` rows now carry `project` info, so cached
   matching (e.g. `getAutoMerge`) can use the project arm without a
   second API round trip.
4. On lifecycle transitions, the set-indicator applier loops over
   `markersOf(setX)` and for each `project` marker calls
   `fetchProjectIdByName` then `setIssueProject`. A `null` id raises
   `Error("Linear project not found: <name>")`.

## Edge cases

- **Issue with no project**: `issue.project` is `null`. Filters with
  `project.name.in` exclude these automatically (Linear's behavior).
  The cached matcher returns `false` for project markers when
  `issue.project` is null.
- **Multiple project markers in a single filter**: ORed by passing all
  names in the `in:` array (matches the existing
  `state.name.in / labels.some.name.in` pattern).
- **`clearConflicted` / `clearReview` with project markers**: rejected
  at parse time. Project removal is out of scope — Linear has no
  symmetric "remove from project" operation we want to model now, and
  the existing label-only guard already exists.
- **Project name with mixed case**: stored verbatim, compared
  case-insensitive in `issueMatchesGetIndicator`. Linear's `name.in`
  filter is case-sensitive server-side; operators are expected to use
  the exact project name as displayed in Linear (matches existing
  `status` marker behavior).

## Out of scope

- A `clearProject` / "remove from project" verb.
- Filtering by Linear `Project.id` (only name).
- Project-level indicators on the project entity itself (this change
  is strictly about indicators that target issues but key off their
  project membership).
