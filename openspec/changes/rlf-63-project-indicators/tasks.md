# Tasks for RLF-63

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-63/project-indicators and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Extend `Marker` union in `packages/types/src/types.ts` with `| { type: "project"; value: string }`; update the file-level comment to name the four supported marker kinds.
- [x] Extend `MarkerSchema` in `packages/workflow/src/schema.ts` to include `"project"` in the `type` enum.
- [x] Update the `IndicatorsSchema.superRefine` error message in `packages/workflow/src/schema.ts` to "markers must be label-typed" so the existing label-only guard rejects any non-label marker (including `project`) in `clearConflicted` / `clearReview`.
- [x] Add a commented `project`-marker example block to `packages/workflow/src/default.ts` showing both a `getTodo` project filter and a `setInProgress` project assignment.
- [x] Extend `LinearIssue` and `LinearNode` in `apps/agent/src/agent/linear.ts` with `project: { id: string; name: string } | null` and request `project { id name }` in `fetchOpenIssues` and `fetchMentionScanIssues` GraphQL queries; map into the typed shape.
- [x] Extend `partition()` in `apps/agent/src/agent/linear.ts` to collect a `projects: string[]` bucket; teach `buildIssueFilter()` to emit `project: { name: { in / nin: [...] } }` for include/exclude, merging via `and:` where existing constraints would collide.
- [x] Extend `issueMatchesGetIndicator()` in `apps/agent/src/agent/linear.ts` to handle the `project` arm by comparing `issue.project?.name.toLowerCase()`; return `false` when the issue has no project.
- [x] Add `fetchProjectIdByName(apiKey, name)` and `setIssueProject(apiKey, issueId, projectId)` helpers to `apps/agent/src/agent/linear.ts`; the former queries `projects(filter: { name: { eq: $name } }, first: 1)`, the latter dispatches `issueUpdate(input: { projectId })`.
- [x] Wire the set-side applier (in `apps/agent/src/agent/wire.ts`, alongside the existing label/status/attachment dispatchers) to handle `project`-typed markers in `setInProgress` / `setDone` / `setError` / `setConflicted` by calling `fetchProjectIdByName` then `setIssueProject`; raise `Error("Linear project not found: <name>")` when the lookup returns null.
- [x] Add tests to `packages/workflow/src/__tests__/workflow.test.ts`: (a) a `project` marker in `getTodo.filter` round-trips through `parseWorkflow`, (b) a `project` marker in `clearConflicted` is rejected with the label-only message.
- [x] Add `apps/agent/src/__tests__/linear-project-indicator.test.ts`: unit-test `issueMatchesGetIndicator` for case-insensitive project matching and the null-project case, and assert the GraphQL filter object shape emitted by `buildIssueFilter` for include + exclude project markers.
- [x] Run `bun run lint` and `bun run test` from the repo root; fix any failures before committing.
- [x] Run `bunx openspec validate rlf-63-project-indicators` and resolve any reported issues.

## Manual Testing

- [x] `Marker` union in `packages/types/src/types.ts` lists `project` alongside `label`, `status`, and `attachment` in the file-level comment, and the union includes `{ type: "project"; value: string }`.
- [x] `MarkerSchema` in `packages/workflow/src/schema.ts` accepts `"project"` in the `type` enum, and `IndicatorsSchema.superRefine` rejects non-label markers in `clearConflicted` / `clearReview` with the message "markers must be label-typed".
- [x] `packages/workflow/src/default.ts` contains a commented example showing both a `getTodo` project filter and a `setInProgress` project assignment, so operators can copy-paste it.
- [x] `parseWorkflow` round-trips a `project` marker in `getTodo.filter` (covered by `packages/workflow/src/__tests__/workflow.test.ts`); manually inspect the test to confirm the asserted shape matches the spec scenario.
- [x] A `project` marker placed under `clearConflicted` / `clearReview` is rejected with the label-only message (covered by the same workflow test file).
- [x] `fetchOpenIssues` / `fetchMentionScanIssues` GraphQL selections in `apps/agent/src/agent/linear.ts` request `project { id name }`, and `LinearIssue` / `LinearNode` expose `project: { id: string; name: string } | null`.
- [x] `buildIssueFilter()` emits `project: { name: { in: [...] } }` for include-only project markers, `project: { name: { nin: [...] } }` for exclude-only, and an `and:` merge when both are present (covered by `apps/agent/src/__tests__/linear-project-indicator.test.ts`).
- [x] `issueMatchesGetIndicator()` matches project markers case-insensitively against `issue.project.name` and returns `false` when `issue.project` is `null` (covered by `linear-project-indicator.test.ts`).
- [x] `fetchProjectIdByName` queries `projects(filter: { name: { eq: $name } }, first: 1)` and `setIssueProject` dispatches `issueUpdate(input: { projectId })` — verify by reading `apps/agent/src/agent/linear.ts`.
- [x] In `apps/agent/src/agent/wire.ts`, the set-side applier handles `project`-typed markers across `setInProgress` / `setDone` / `setError` / `setConflicted`, and raises a static-message error (`Linear project not found`) with the project name carried in a structured context field when the lookup returns null.
- [x] `bun run lint` and `bun run test` both pass from the repo root.
- [x] `bunx openspec validate rlf-63-project-indicators` reports the change as valid.
