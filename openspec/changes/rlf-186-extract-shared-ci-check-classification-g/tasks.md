# Tasks for RLF-186

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-186/extract-shared-ci-check-classification-gh-retry-helper and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.
- [x] Is there anything else to add? Review the complete change context and document any additional edge cases, constraints, or open questions not captured above.

## Implementation

- [x] Create `apps/agent/src/shared/pr/ci-classify.ts` with: exported `RawCheck` interface, `classifyCheck(c: RawCheck): "pass" | "fail" | "pending" | "skip"` function, `classifyGhBucket(bucket: string): "pass" | "fail" | "pending" | "skip"` function, and moved exports `TRANSIENT_GH_RE`, `NO_CHECKS_RE`, `GH_RETRY_DELAYS`, `runGhWithRetry`
- [x] Create `apps/agent/src/shared/pr/__tests__/ci-classify.test.ts` with unit tests for `classifyCheck` covering: Actions check pending (IN_PROGRESS, QUEUED, WAITING), Actions check pass (COMPLETED+SUCCESS, COMPLETED+NEUTRAL), Actions check skip (COMPLETED+SKIPPED), Actions check fail (COMPLETED+FAILURE, COMPLETED+TIMED_OUT, COMPLETED+CANCELLED), legacy commit status pending (PENDING, EXPECTED), legacy commit status pass (SUCCESS), legacy commit status fail (FAILURE, ERROR)
- [x] Refactor `apps/agent/src/agent/ci.ts` to import `runGhWithRetry`, `TRANSIENT_GH_RE`, `NO_CHECKS_RE`, `GH_RETRY_DELAYS` from `ci-classify.ts` and remove the private definitions; replace inline `c.bucket === "fail" || c.bucket === "cancel"` and `c.bucket === "skipping"` comparisons with `classifyGhBucket(c.bucket)`
- [x] Refactor `apps/agent/src/pr-status.ts::bucketChecks` to import `classifyCheck` from `ci-classify.ts` and replace the inline per-check status/conclusion/state logic with `classifyCheck(c)` calls; keep the empty-rollup and pending-aggregate logic intact
- [x] Run `bun run lint` and fix any issues
- [x] Run `bun run test` and confirm all existing tests still pass (no modifications to `ci.test.ts` or `pr-status.test.ts` required)
