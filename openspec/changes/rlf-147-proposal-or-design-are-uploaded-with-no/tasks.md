# Tasks for RLF-147

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-147/proposal-or-design-are-uploaded-with-no-content and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `hasMeaningfulContent(bytes)` helper in `apps/agent/src/agent/linear-sync/spec-attachments.ts` that strips blank lines, `#` headings, italic-only `_..._` placeholders, and `Source:` / `Status:` / `Assignee:` / `Labels:` metadata lines, returning true iff any line remains
- [x] Gate `syncSlot` on `hasMeaningfulContent(sourceBytes)` immediately after reading the source — skip with a gray `spec-attachments: <file> has no content yet, skipping` log and leave `.ralph-state.json` untouched
- [x] Add a test in `apps/agent/src/__tests__/linear-spec-attachments.test.ts` proving an all-placeholder `proposal.md` + `design.md` triggers zero uploads, zero creates, and no state file
- [x] Add a test proving a follow-up run with real prose content uploads normally and persists the sha256
- [x] Run `bun run lint` and `bun run test` and ensure both pass
- [x] Run `bunx openspec validate rlf-147-proposal-or-design-are-uploaded-with-no` and ensure it reports valid

## Manual Testing

- [x] Run the focused test suite `bun test apps/agent/src/__tests__/linear-spec-attachments.test.ts` and confirm both RLF-147 cases (scaffold-only skip, real-content upload) pass — 17/17 passed
- [x] Spot-check `hasMeaningfulContent` against representative scaffold lines (`# heading`, `_placeholder_`, `Source:` / `Status:` / `Assignee:` / `Labels:`, blank) and confirm it returns false for a pure-scaffold buffer and true as soon as one prose line is appended
- [x] Confirm the skip path leaves `.ralph-state.json` untouched — the scaffold-only test (`linear-spec-attachments.test.ts:527`) asserts no state file is written and zero upload/create calls fire
- [x] Run `bunx openspec validate --specs --strict` and confirm `spec/linear-spec-attachments` (now containing the RLF-147 requirement and scenarios) passes
