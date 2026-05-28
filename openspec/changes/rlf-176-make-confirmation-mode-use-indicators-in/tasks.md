# Tasks for RLF-176

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-176/make-confirmation-mode-use-indicators-instead-of-special-case-labels and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)

## Implementation

- [x] Add `getConfirmGate` and `getAutoApprove` to `IndicatorsSchema` in `packages/workflow/src/schema.ts` (both `GetIndicatorSchema.optional()`)
- [x] Remove `optOutLabel` and `optInLabel` from the `confirmationMode` sub-schema and its defaults in `packages/workflow/src/schema.ts`
- [x] Update `computeConfirmationFlags` in `packages/workflow/src/confirmation.ts` to use `matchesIndicator(getConfirmGate, ticket)` and `matchesIndicator(getAutoApprove, ticket)` instead of label string checks
- [x] Update `GateInputs` interface in `packages/core/src/detections/gate.ts` — remove `optInLabel` and `optOutLabel` from `config.confirmationMode`; simplify `gateActive` to only check `enabled` and `confirmedAt`
- [x] Update `WORKFLOW.md` (live config): remove `optInLabel`/`optOutLabel` from `confirmationMode:` block; add `getConfirmGate` and `getAutoApprove` indicator examples in the `indicators:` section
- [x] Update default WORKFLOW.md template in `packages/workflow/src/default.ts`: replace `optInLabel`/`optOutLabel` comment lines with `getConfirmGate`/`getAutoApprove` indicator examples
- [x] Update `packages/workflow/src/__tests__/confirmation.test.ts`: replace `optInLabel`/`optOutLabel` yaml in all test cases with indicator-based config; add tests for `getConfirmGate` and `getAutoApprove` indicator behavior
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and fix any failures
