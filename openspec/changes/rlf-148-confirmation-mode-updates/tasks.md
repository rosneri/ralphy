# Tasks for RLF-148

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-148/confirmation-mode-updates and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [ ] Extend `packages/workflow/src/schema.ts` `IndicatorsSchema` with `setAwaitingConfirmation` (SetIndicator) and `clearAwaitingConfirmation` (SetIndicator, label-only via the existing `superRefine`)
- [ ] Extend the exported `Indicators` type in `packages/types/src/types.ts` (and any re-exports) to surface both new fields
- [ ] Add a schema unit test covering: accept setAwaitingConfirmation as marker or marker[]; reject clearAwaitingConfirmation with a non-label marker
- [ ] Add commented-out examples for both indicators under the "Confirmation gate" block in `packages/workflow/src/default.ts` `DEFAULT_WORKFLOW_MD`
- [ ] Extend `ConfirmationState` in `apps/agent/src/features/confirmation/state.ts` with `awaitingMarkerAppliedAt: string | null` (default null), and ensure `readConfirmationState` back-fills it for older state files
- [ ] In `apps/agent/src/features/confirmation/awaiting.ts`, apply `setAwaitingConfirmation` once per gate-entry (guarded by `awaitingMarkerAppliedAt`) before posting the plan-ready comment; persist the stamp on success
- [ ] In every release path in `awaiting.ts` (`gate-cleared`, `tasks-empty`, stub-artifact, outcome=approved, outcome=revised), apply `clearAwaitingConfirmation` if configured and the stamp is set; null the stamp afterward (even on apply failure — defence in depth matches `clearApproved`)
- [ ] Rewrite the plan-ready comment body in `postPlanReadyCommentOnce` to enumerate the configured `getApproved` marker(s) and the `@ralphy revise:` syntax; keep the body literally hardcoded in source
- [ ] Add a helper (e.g. `describeApprovalMarker(indicator)`) — extract to `packages/workflow` if reusable — that formats `getApproved` markers into the human sentence used in the comment
- [ ] Add awaiting-test cases in `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts`: setAwaitingConfirmation fires once across multiple polls; clearAwaitingConfirmation fires on approve / revise / tasks-empty / stub-artifact / gate-cleared
- [ ] Add a plan-ready-comment test asserting the body includes the configured marker (`ralph:approved`) AND the `@ralphy revise:` literal; add a fallback test asserting the generic sentence appears when `getApproved` is unset
- [ ] Run `bunx openspec validate rlf-148-confirmation-mode-updates` and resolve any validator errors
- [ ] Run `bun run lint` and fix any new findings introduced by this change
- [ ] Run `bun run test` and confirm the full suite (including new tests) passes; do not lower the coverage threshold
