# Tasks for RLF-80

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-80/comment-indicator and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `{ type: "comment"; value: string }` to the `Marker` union in `packages/types/src/types.ts` and update every exhaustive marker switch the compiler flags (start with `markersToFilters` in `apps/agent/src/shared/capabilities/linear-client.ts`, which MUST treat `comment` as a no-op for the GraphQL pre-filter).
- [x] Extend the issue type accepted by `issueMatchesGetIndicator` to include an optional `comments` slice (`{ body: string; user?: { name: string } | null }[]`) and add a `comment` branch that returns `true` only when a non-Ralph comment (per `isRalphComment` from `apps/agent/src/agent/wire/task-bodies.ts`) contains `value` as a case-insensitive substring. Missing/empty `comments` MUST return `false` without throwing.
- [x] Update the Linear GraphQL fetcher(s) used by `getX` evaluation in `apps/agent/src/shared/capabilities/linear-client.ts` to include the `comments { nodes { id body createdAt user { name } } }` selection set whenever any active indicator carries a `comment` marker; keep the slim query for callers that don't need it.
- [x] Reject `comment` markers in every `SetIndicator` slot (`setInProgress`, `setDone`, `setError`, `setConflicted`, `clearConflicted`, `clearReview`, `clearApproved`) at config-load time with an error that names the offending slot. Also reject empty `value` strings for any `comment` marker (get or set).
- [x] Update CLI marker parsing (`apps/agent/src/cli.ts`) so users can configure `comment:<text>` from flags, and verify `describeIndicators` prints `comment:<value>` for configured markers (add a regression test if missing).
- [x] Extend `apps/agent/test/harness/fake-linear.ts` so test issues can carry comments and the harness honours `comment` markers end-to-end.
- [x] Add unit tests in `apps/agent/src/shared/capabilities/__tests__/linear-client.test.ts` (or a sibling file) covering: match on non-Ralph comment, skip Ralph-authored comments, case-insensitive substring, and `undefined` comments → `false`.
- [x] Add a config-loader test asserting that `setDone: { type: "comment", value: "x" }` and `{ type: "comment", value: "" }` both throw with the expected error messages.
- [x] Add a harness integration test asserting an issue with a matching non-Ralph comment is picked up by a `getTodo` `comment` indicator, and one whose only match is Ralph-authored is not.
- [x] Run `bunx openspec validate rlf-80-comment-indicator` and address any validator findings.
- [x] Run `bun run lint` and address any findings.
- [x] Run `bun run test` and ensure the full suite (including the new tests) passes.
- [x] Commit all changed files, push the branch, and open the PR with title `rlf-80-comment-indicator` and a short summary body.

## Manual Testing

- [x] CLI parses `--indicator getTodo:comment:ralph go` and stores `{ type: "comment", value: "ralph go" }` under `indicators.getTodo.filter`.
- [x] `describeIndicators` renders the configured marker as `todo=[comment:ralph go]`.
- [x] CLI rejects `--indicator getTodo:comment:` (empty value) with `indicator value cannot be empty`.
- [x] CLI rejects `--indicator getTodo:bogus:x` with a message listing the supported types including `comment`.
- [x] `printHelp()` lists `comment` alongside `label, status, attachment, project` in the `--indicator` types line.
- [x] Workflow schema rejects `linear.indicators.setDone = { type: "comment", value: "done" }` with the read-only-marker message that names the offending slot.
- [x] Workflow schema rejects `comment` marker with an empty `value` (zod min(1) violation).
- [x] Workflow schema accepts a valid `linear.indicators.getTodo` filter containing `{ type: "comment", value: "ralph go" }`.
