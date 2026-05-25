# Tasks for RLF-76

## Manual Testing

- [x] All core test suites pass: run `bun test packages/core/src/__tests__/openspec-phase.test.ts packages/core/src/__tests__/loop.test.ts packages/engine/src/__tests__/agents.test.ts apps/agent/src/agent/linear-sync/__tests__/review-comment.test.ts packages/workflow/src/__tests__/workflow.test.ts` and confirm 82 + 40 + 23 + 7 + 38 = 190 tests pass with 0 failures.
- [x] Verify `deriveOpenSpecPhase` with review enabled: run `bun -e "import { deriveOpenSpecPhase } from './packages/core/src/openspec/phase.ts'; console.log(deriveOpenSpecPhase({ proposal: 'x', design: 'x', tasks: '- [x] done', reviewFindings: null, reviewRounds: 0, maxReviewRounds: 3 }))"` and confirm it prints `review`.
- [x] Verify review → design loop-back: run `bun -e "import { deriveOpenSpecPhase } from './packages/core/src/openspec/phase.ts'; console.log(deriveOpenSpecPhase({ proposal: 'x', design: 'x', tasks: '- [x] done', reviewFindings: '## Open\n\n- [ ] bug', reviewRounds: 0, maxReviewRounds: 3 }))"` and confirm it prints `design`.
- [x] Verify max-rounds cap: run `bun -e "import { deriveOpenSpecPhase } from './packages/core/src/openspec/phase.ts'; console.log(deriveOpenSpecPhase({ proposal: 'x', design: 'x', tasks: '- [x] done', reviewFindings: '## Open\n\n- [ ] bug', reviewRounds: 3, maxReviewRounds: 3 }))"` and confirm it prints `done`.
- [x] Verify `phasePipeline("review")` shows review as current: run `bun -e "import { phasePipeline } from './packages/core/src/openspec/phase.ts'; console.log(JSON.stringify(phasePipeline('review').map(s => s.phase + ':' + s.status)))"` and confirm review has status `current` and earlier phases have `done`.
- [x] Verify `shouldShowPhasePipeline` returns true for "review": run `bun -e "import { shouldShowPhasePipeline } from './packages/core/src/openspec/phase.ts'; console.log(shouldShowPhasePipeline('review'), shouldShowPhasePipeline('implement'), shouldShowPhasePipeline('done'))"` and confirm it prints `true false false`.
- [x] Verify `review-self.md` prompt completeness: run `bun -e "const t = await Bun.file('./packages/content/src/review-self.md').text(); console.log(['proposal.md','design.md','tasks.md','git diff','review-findings.md','## Open','(no findings — close round)'].every(s => t.includes(s)))"` and confirm it prints `true`.
- [x] Run `bunx nx run agent:typecheck` and confirm it exits 0 — validates AgentMode's review phase rendering compiles without error.
- [x] Run `bunx openspec validate rlf-76-add-a-self-review-phase-that-loops-back` and confirm it exits 0.
