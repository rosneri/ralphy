# Tasks for RLF-20

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-20/pre-existing-errors-detection and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [x] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Add `preExistingErrorCheck` block to `packages/workflow/src/schema.ts` (`enabled`, `commands`, `baseBranch`, `label`, `outputCharLimit`) with safe defaults
- [x] Update `packages/workflow/src/default.ts` to include the new block (disabled by default)
- [x] Add a `resolveBaselineCommands(config)` helper in `packages/workflow/src/workflow.ts` that falls back to `commands.lint` / `commands.test` when the user list is empty, plus a unit test
- [x] Create `apps/agent/src/agent/baseline.ts` with a pure `runBaseline({ cmdRunner, gitRunner, cwd, commands, baseBranch, outputCharLimit })` function returning `{ ok, failures, fingerprint }`
- [x] Add `apps/agent/src/__tests__/baseline.test.ts` covering: all-pass, one-failing-command, fingerprint stability, output truncation, git checkout failure handled gracefully
- [x] Extend `apps/agent/src/agent/linear.ts` with `createIssue`, `updateIssueDescription`, and `findOpenIssueByLabel` helpers, including unit tests with fetch stubs in `apps/agent/src/__tests__/linear.test.ts`
- [x] Add `isPaused` / `setPaused` / `clearPaused` to `AgentCoordinator` and gate `pickFresh`/`pickResume`/`pickConflict`/`pickReview` on it; add coordinator tests for the gate
- [x] Create `apps/agent/src/agent/baseline-gate.ts` orchestrating: run baseline → dedupe via Linear issue body fingerprint comment → create/update issue → set/clear coordinator pause
- [x] Add `apps/agent/src/__tests__/baseline-gate.test.ts` covering: clean baseline (no-op), broken baseline (issue created + pause set), unchanged fingerprint (no duplicate), changed fingerprint (issue updated), baseline recovers (pause cleared), Linear ticket closed by human while baseline still red (new ticket opened)
- [x] Wire the gate into `apps/agent/src/agent/wire.ts` so it runs once per poll tick before bucket scan
- [x] Add `--pre-existing-error-check` flag to `apps/agent/src/cli.ts` and propagate into the resolved config; add a CLI parser test
- [x] Surface a `BASELINE BROKEN <LIN-ID> · <duration>` banner in `apps/agent/src/components/AgentMode.tsx` (or the existing status panel) when `coordinator.isPaused()` is set
- [x] Update `README.md` with the new config block, CLI flag, and lifecycle description
- [x] Run `bun run lint`
- [x] Run `bun run test`
- [x] Run `bunx openspec validate rlf-20-pre-existing-errors-detection`
- [x] Commit each touched file individually (no `git add -A` / `git commit -am`)
- [x] Push branch and open the PR titled `rlf-20-pre-existing-errors-detection` with a concise summary
