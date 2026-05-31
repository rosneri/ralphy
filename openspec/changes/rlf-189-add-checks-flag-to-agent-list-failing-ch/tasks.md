# Tasks for RLF-189

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-189/add-checks-flag-to-agent-list-failing-check-names and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Extend `CiStatus` in `apps/agent/src/agent/ci.ts`: add `failedCheckNames: string[]` field and populate it in `getPrChecksStatus` from failing checks' `name` field
- [x] Update `apps/agent/src/__tests__/ci.test.ts`: add `failedCheckNames` to all `getPrChecksStatus` test expectations; add a test that failing check names are correctly extracted
- [x] Add `checks: boolean` to `AgentParsedArgs` in `apps/agent/src/cli.ts`; parse `--checks` flag; add a help-text line (e.g. `--checks: List mode: show failing CI check names per PR`)
- [x] Update `apps/agent/src/__tests__/cli.test.ts`: add a test that `agent list --checks` sets `args.checks = true`
- [x] Thread `checks: args.checks` from `apps/agent/src/index.ts` into the `runList()` call
- [x] Add `checks: boolean` to `RunListInput` and `failedCheckNames?: string[]` to `UnifiedRow` in `apps/agent/src/list.ts`
- [x] Update `formatPrStatusMarker` in `apps/agent/src/list.ts` to accept an optional `failedCheckNames` argument; when non-empty and `ciBucket === "fail"`, render `✗ci[name1, name2]` instead of bare `✗ci`; export it for testing
- [x] Add a second conditional fan-out in `fetchAndPrintLinear` (list.ts): when `checks` is true, call `getPrChecksStatus` for each row with `ciBucket === "fail"` and a known `prUrl`, storing results in `row.failedCheckNames`; wrap in try/catch to fall back to empty names on error
- [x] Add `apps/agent/src/__tests__/list-marker.test.ts`: unit tests for `formatPrStatusMarker` covering (a) with non-empty `failedCheckNames` → renders expanded form, (b) with empty `failedCheckNames` → renders bare `✗ci`, (c) without flag (no second argument) → renders bare `✗ci`
- [x] Run `bun run lint` and fix any lint errors
- [x] Run `bun run test` and fix any test failures
