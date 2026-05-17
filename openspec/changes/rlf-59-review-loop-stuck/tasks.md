# Tasks for RLF-59

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-59/review-loop-stuck and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] In `apps/agent/src/agent/wire.ts`, add a closure-scope `const lastHandledReviewActivity = new Map<string, string>();` next to the existing `stalePingedAt` map (`wire.ts:580`).
- [x] Modify `scanCodeReview` (`apps/agent/src/agent/wire.ts:1464-1498`) so the trigger check compares `newestReviewerActivity` against the max of `lastRalphPickup` and `lastHandledReviewActivity.get(prUrl)`; on a fresh trigger, set `lastHandledReviewActivity.set(prUrl, newestReviewerActivity)` before returning.
- [x] Ensure the short-circuit path still calls `maybePingStaleReviewer(...)` so stale-reviewer ping behaviour is unaffected.
- [x] Add `apps/agent/src/__tests__/code-review-trigger-dedupe.test.ts` with three tests mirroring the spec scenarios: (a) `postComments: false` — same reviewer comment fires once across two polls; (b) a newer reviewer comment at `T2 > T1` still fires; (c) Linear pickup-comment post failure does not cause a re-fire loop.
- [x] Run `bun run lint` and fix any reported issues.
- [x] Run `bun run test` and confirm new + existing tests pass; do not lower any coverage threshold.
- [x] Run `bunx openspec validate rlf-59-review-loop-stuck` and confirm it passes.

## Manual Testing

- [x] Run `bun test apps/agent/src/__tests__/code-review-trigger-dedupe.test.ts` and confirm all three dedupe scenarios pass (postComments-false fires once, newer reviewer activity still fires, Linear pickup-comment failure does not re-fire).
- [x] Inspect `apps/agent/src/agent/wire.ts` and confirm `lastHandledReviewActivity` is a closure-scope `Map<string, string>` co-located with `stalePingedAt`, set synchronously inside `scanCodeReview` _before_ the trigger is returned so a concurrent poll cannot race in.
- [x] Confirm the short-circuit branch in `scanCodeReview` still invokes `maybePingStaleReviewer(...)` so stale-reviewer pings keep working when a reviewer comment is debounced.
- [x] Verify the in-process map is keyed by `prUrl` (not by issue/branch), so two PRs on the same Linear issue debounce independently.
- [x] Verify the trigger check uses the _max_ of `lastRalphPickup` and `lastHandledReviewActivity.get(prUrl)` (`wire.ts:1484-1489`), so the durable Linear sentinel still wins when it is newer than the in-process value (e.g. after an agent restart).
- [x] Run `bunx openspec validate rlf-59-review-loop-stuck` and confirm it still reports valid after adding the Manual Testing section.
