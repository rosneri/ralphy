# Tasks for RLF-109

## Planning

- [x] Research codebase: audit linear-client.ts functions, check coverage thresholds, understand CI failure
- [x] Fill in proposal.md with Why / What Changes / Acceptance Criteria
- [x] Fill in design.md with files to touch, function coverage plan, integration test design
- [x] Add spec under specs/linear-client-coverage/spec.md describing coverage requirements
- [x] Write this tasks.md with concrete implementation checklist

## Implementation

- [x] Audit all exported + non-exported functions in `linear-client.ts` and record which are already covered
- [x] Add `fetchOpenIssues` tests to `linear-client.test.ts` (basic success, empty result)
- [x] Add `fetchIssueComments` tests (success, empty comments array)
- [x] Add `fetchWorkflowStates` tests (returns mapped state list)
- [x] Add `fetchTeamIdByKey` tests (found, not found → undefined)
- [x] Add `fetchIssueLabels` tests (success)
- [x] Add `fetchIssueAttachments` and `findIssueAttachmentByTitle` tests (found, not found)
- [x] Add `fetchProjectIdByName` tests (found, not found)
- [x] Add `findOpenIssueByLabel` tests (delegates to fetchOpenIssues with label filter)
- [x] Add `addIssueComment` and `updateIssueComment` tests
- [x] Add `deleteIssueComment` test
- [x] Add `createIssueLabel` test
- [x] Add `addLabelToIssue` and `removeLabelFromIssue` tests
- [x] Add `updateIssueState` test
- [x] Add `createRalphyAttachment` and `updateAttachmentSubtitle` tests
- [x] Add `upsertRalphyAttachment` tests: existing-found (update path) and not-found (create path)
- [x] Add `setIssueProject` and `createIssue` and `updateIssueDescription` tests
- [x] Add `buildIssueFilter` and `clauseFromMarkers` unit tests (pure, no fetch needed)
- [x] Add `baseBranchFromLabels` unit tests (pure, no fetch needed)
- [x] Add prependTask event emission test to `fs-change.test.ts`
- [x] Add createWorktree success-event assertion to `git.test.ts`
- [x] Create `apps/agent/src/__tests__/mention-scan-integration.test.ts` with three scenarios: trigger-found, no-issues, rate-limit-propagation
- [x] Run `bun run lint` and confirm no new errors
- [x] Run `bun test apps/agent/src/shared/capabilities/__tests__/linear-client.test.ts` — all pass
- [x] Run `bun test apps/agent --coverage` and confirm lines ≥ 90%, functions ≥ 75%
