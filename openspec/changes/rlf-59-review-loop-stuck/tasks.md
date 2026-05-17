# Tasks for RLF-59

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-59/review-loop-stuck and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [ ] In `apps/agent/src/agent/wire.ts`, add a closure-scope `const lastHandledReviewActivity = new Map<string, string>();` next to the existing `stalePingedAt` map (`wire.ts:580`).
- [ ] Modify `scanCodeReview` (`apps/agent/src/agent/wire.ts:1464-1498`) so the trigger check compares `newestReviewerActivity` against the max of `lastRalphPickup` and `lastHandledReviewActivity.get(prUrl)`; on a fresh trigger, set `lastHandledReviewActivity.set(prUrl, newestReviewerActivity)` before returning.
- [ ] Ensure the short-circuit path still calls `maybePingStaleReviewer(...)` so stale-reviewer ping behaviour is unaffected.
- [ ] Add `apps/agent/src/__tests__/code-review-trigger-dedupe.test.ts` with three tests mirroring the spec scenarios: (a) `postComments: false` — same reviewer comment fires once across two polls; (b) a newer reviewer comment at `T2 > T1` still fires; (c) Linear pickup-comment post failure does not cause a re-fire loop.
- [ ] Run `bun run lint` and fix any reported issues.
- [ ] Run `bun run test` and confirm new + existing tests pass; do not lower any coverage threshold.
- [ ] Run `bunx openspec validate rlf-59-review-loop-stuck` and confirm it passes.
