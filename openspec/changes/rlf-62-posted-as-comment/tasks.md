# Tasks for RLF-62

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-62/posted-as-comment and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `updateIssueComment(apiKey, commentId, body)` and `deleteIssueComment(apiKey, commentId)` exports to `apps/agent/src/agent/linear.ts`, using the existing `linearRequest` helper and the `commentUpdate` / `commentDelete` GraphQL mutations. Include unit tests in `apps/agent/src/__tests__/linear-comment-mutations.test.ts` that stub `fetch` and assert the mutation strings and variables.
- [x] Extend the agent config schema (locate `linear.syncTasksToDescription` and add `linear.syncTasksToComment: boolean` with default `true`); flip the default of `syncTasksToDescription` to `false`. Update any zod / TypeScript schema and the README/config snippet that documents these flags.
- [x] Persist the per-change comment ids: extend the `.ralph-state.json` writer/reader (search for the type and JSON.stringify call site) to include `linearComments: { planCommentId, tasksCommentId, planPostedAt }` (all optional). Migration is implicit — missing fields default to `null`.
- [x] Create `apps/agent/src/agent/linear-sync/comment-sync.ts` with three orchestrators: `postOrUpdateTasksComment`, `postPlanCommentOnce`, `postSteeringAndRefreshTasks`. Reuse `renderTasksBlock` from `./index.ts` for the tasks body. Each orchestrator takes a deps bag (apiKey, issueId, statePath, log, mutations) so tests can inject fakes.
- [x] Wire the new sync into `apps/agent/src/agent/wire.ts`: replace the `syncTasksToDescription` branch around line 1780 with a comment-sync branch when `cfg.linear.syncTasksToComment && apiKey`. Keep the legacy description branch behind `syncTasksToDescription && !syncTasksToComment` for back-compat. Log a one-time warning when both flags are true.
- [x] Detect "planning complete" inside `postPlanCommentOnce` by parsing `tasks.md` and checking that every `- [ ]` under `## Planning` is now `- [x]`. Body composition: include the rendered proposal `## Why` + `## What Changes` and a compact summary of design.md (first paragraph). Skip when no API key, no issue, or `planCommentId` already set.
- [x] Extend `packages/openspec/src/openspec-change-store.ts:appendSteering` so it ALSO appends `- [ ] Address steering: <first line>` to a `## Steering` section in `tasks.md` (create the section if missing). Add a unit test in `packages/openspec/src/__tests__/openspec-change-store.test.ts` covering both branches.
- [x] Add a coordinator hook `onSteeringAppended(changeName, message)` (search `coordinator.ts`, mirror the `syncTasks` deps shape) that invokes `comment-sync.postSteeringAndRefreshTasks`. Wire it from `apps/mcp/src/tools.ts` so the `ralph_append_steering` MCP tool triggers it after the local file write succeeds.
- [x] Implement the "comment was deleted manually" recovery branch in `postOrUpdateTasksComment`: catch the not-found error class/messages from the Linear API (the existing `linearRequest` surfaces `errors[].message`) and fall back to `commentCreate`. Cover with a fake-fetch unit test.
- [x] Add integration-style tests in `apps/agent/src/__tests__/linear-comment-sync.test.ts` covering: first-sync creates comment, subsequent sync updates in place, plan posted once, steering deletes + recreates tasks comment, missing api key skips. Mock the Linear API via fetch stubs (see the pattern in `linear-tasks-sync.test.ts`).
- [x] Update or migrate `apps/agent/src/__tests__/linear-tasks-sync.test.ts` for the new default (`syncTasksToComment: true`). Keep at least one regression test that exercises the legacy description-sync path under the explicit opt-in.
- [x] Run `bunx openspec validate rlf-62-posted-as-comment` and confirm it passes.
- [x] Run `bun run lint` from the repo root and fix any new violations introduced by these changes.
- [x] Run `bun run test` and ensure all suites pass; do NOT lower the coverage threshold (project rule).
- [x] Stage each modified file by path (no `git add -A`) and commit with a message that summarizes the comment-sync switch and references RLF-62.
