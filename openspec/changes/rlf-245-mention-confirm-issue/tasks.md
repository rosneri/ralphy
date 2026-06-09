# Tasks for RLF-245

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-245/mention-confirm-issue and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases). design.md holds prose and tables ONLY — never a task checklist; the implementation tasks belong in this tasks.md file (next item).
- [x] Append an `## Implementation` section to **this tasks.md file** (below the `## Planning` section above — NOT in design.md) with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] In `packages/core/src/__tests__/detections-mention.test.ts`, update the `buildMentionAckComment` tests: keep the title + `mention-ack` marker + greeting assertions; replace every `> …` / excerpt / ellipsis assertion with assertions that the result contains NO blockquote line and does NOT echo the mention body (write these as the failing-first specs for the change).
- [x] In the same test file, add `hasMentionTrigger` cases: (a) a comment carrying `<!-- ralphy:v=1 type=mention-ack -->` with the trigger phrase and `isRalph: false` → `false`; (b) a comment starting with `🤖 Ralphy · …` with the trigger phrase and `isRalph: false` → `false`; keep an existing/added human-comment case → `true`.
- [x] In `packages/core/src/detections/mention.ts`, remove the `> ${excerpt}` quote (and the now-dead `firstLine` / `truncated` / `excerpt` locals) from `buildMentionAckComment`, leaving `body: greeting`.
- [x] In the same file, import `isRalphyComment` from `@ralphy/comms` and update `hasMentionTrigger` to skip comments where `isRalphyComment(c.body)` is true, in addition to the existing `!c.isRalph` guard.
- [x] Run `bunx openspec validate rlf-245-mention-confirm-issue` and confirm it passes.
- [x] Run `bun run lint` and fix any findings.
- [x] Run `bun run test` (at minimum `bun test packages/core/src/__tests__/detections-mention.test.ts`) and confirm all pass without reducing the coverage threshold.
