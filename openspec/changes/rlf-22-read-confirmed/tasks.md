# Tasks for RLF-22

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-22/read-confirmed and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [ ] Add `addReactionToComment(apiKey, commentId, emoji)` to `apps/agent/src/agent/linear.ts` using a `reactionCreate` GraphQL mutation
- [ ] Add `addGithubReactionToComment(source, commentId, emoji)` helper in `apps/agent/src/agent/wire.ts` that POSTs via `gh api` to the correct `/reactions` endpoint for issue comments vs PR review comments (mapping `👀` → `eyes`)
- [ ] Wire reaction calls into `fetchMentions()` in `apps/agent/src/agent/wire.ts`: after pushing each new `MentionTrigger`, invoke the matching reaction helper inside a try/catch that logs and continues so failures never block enqueue
- [ ] Add unit tests for the Linear `reactionCreate` mutation (mock fetch, assert payload includes commentId + `👀`)
- [ ] Add unit tests for the GitHub reaction helper (mock `Bun.spawn` for `gh api`, assert endpoint + `content=eyes`) and for the wire-layer error-swallow path (reaction throws → trigger still returned)
- [ ] Run `bunx openspec validate rlf-22-read-confirmed`
- [ ] Run `bun run lint`
- [ ] Run `bun run test`
