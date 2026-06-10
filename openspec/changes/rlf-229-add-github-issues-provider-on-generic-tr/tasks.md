# Tasks for RLF-229

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-229/add-github-issues-provider-on-generic-tracker-contract and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

### Transport (github.ts)

- [x] In `apps/agent/src/agent/wire/tracker/github.ts`, rename the transport factory `createGithubTrackerProvider` → `createGithubProvider` (return type stays `TrackerProvider & { listOpenIssues, repo }`). Keep `githubIndicators` and `identifierForNumber` exports.
- [x] Add a `fetchComments(issueId: string): Promise<{ body: string }[]>` method to the transport that runs `gh issue view <id> --json comments` and maps `comments[].body`; guard `JSON.parse(stdout || "{}")` so an issue with no comments returns `[]`.

### Contract seam (github-tracker-provider.ts)

- [x] Replace the standalone, self-`gh`-calling `createGithubTrackerProvider` with a delegating contract-seam factory: `createGithubTrackerProvider({ provider, indicators, excludeFromTodo, fetchMentions }) → IssueTrackerProvider`, mirroring `createLinearTrackerProvider`.
- [x] Map the seam methods: `fetchTodo`/`fetchInProgress` → `provider.fetchByGet(...)`; `fetchDoneCandidates` → `provider.fetchDoneCandidates()`; `fetchComments` → `provider.fetchComments(id)`; `applyIndicator`/`removeIndicator` → transport; `postComment` → `provider.applyMarker(issue, { type: "comment", value: body })`; `fetchReview` → `[]` with an intentional-not-stub comment; `fetchMentions` → injected.
- [x] Retain the pure helpers (`mapGithubIssue`, `flattenLabel`, `githubIndicatorAction`, `staleStatusLabels`) so `fake-github.ts` keeps working.

### Wiring (wire.ts)

- [x] Update imports: transport from `./wire/tracker/github` is now `createGithubProvider`; import `createGithubTrackerProvider` from `./wire/tracker/github-tracker-provider`.
- [x] Replace the inline GitHub `tracker` object (the `fetchReview: []` / `fetchComments: []` branch) with a call to `createGithubTrackerProvider({ provider, indicators, excludeFromTodo, fetchMentions })`. Leave the Linear branch untouched.

### Tests & gates

- [x] Update `apps/agent/src/agent/wire/tracker/__tests__/github.test.ts` for the renamed transport factory and add a `fetchComments` test (with-comments and empty cases).
- [x] Rework `apps/agent/src/agent/wire/tracker/__tests__/github-tracker-provider.test.ts` to drive the delegating seam via a scripted transport; assert `fetchComments` returns real comments and `fetchReview` returns `[]`.
- [x] Confirm `apps/agent/test/harness/fake-github.ts` and the provider-contract suite still satisfy `IssueTrackerProvider` (incl. real `fetchComments`); fix import paths if helpers moved.
- [x] Grep the repo to confirm exactly one `createGithubTrackerProvider` declaration remains (avoid the duplicate-declaration pre-PR hook).
- [x] Run `bun run lint` and `bun run test` — both pass; coverage threshold not reduced.
- [x] Run `bunx openspec validate rlf-229-add-github-issues-provider-on-generic-tr`.
