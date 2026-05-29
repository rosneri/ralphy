# Tasks for RLF-184

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-184/comment-when-ralphy-sees-a-mention and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Add `buildMentionAckComment(body: string, author?: string): string` to `packages/core/src/detections/mention.ts` — pure function returning the ack comment markdown
- [x] Add unit tests for `buildMentionAckComment` in `packages/core/src/__tests__/detections-mention.test.ts` covering: with author, without author, long body truncation, single-line body, multiline body (only first line quoted)
- [x] Add `postGithubPrComment(cmdRunner, projectRoot, prUrl, body, onLog)` to `apps/agent/src/features/mention/github.ts`
- [x] In `apps/agent/src/agent/wire/mention-scan.ts`: import `createIssueComment` from `../linear` and `buildMentionAckComment` from `@ralphy/core/detections/mention`; after the Linear reaction call, post the ack comment if `cfg.linear.postComments !== false`
- [x] In `apps/agent/src/agent/wire/mention-scan.ts`: import `postGithubPrComment` from `../../features/mention/github`; after the GitHub reaction call, post the ack comment if `cfg.linear.postComments !== false`
- [x] Add test to `apps/agent/src/__tests__/mention-reaction.test.ts`: ack comment is posted on Linear mention when `postComments: true` (check `pickupCommentBodies` contains the ack body)
- [x] Add test to `apps/agent/src/__tests__/mention-reaction.test.ts`: no ack comment when `postComments: false`
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and fix any failures
- [x] Run `bunx openspec validate rlf-184-comment-when-ralphy-sees-a-mention` and confirm it passes
