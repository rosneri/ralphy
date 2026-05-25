## Fix failing CI checks (2026-05-25T18:58:47.214Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26415426351 ---
ci Typecheck (affected) ﻿2026-05-25T18:56:46.9194225Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-25T18:56:46.9194577Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-25T18:56:46.9229780Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-25T18:56:46.9230049Z env:
ci Typecheck (affected) 2026-05-25T18:56:46.9230299Z NX_BASE: ab6e0624036fca26c564c66eec74d171c8ba5d2d
ci Typecheck (affected) 2026-05-25T18:56:46.9230644Z NX_HEAD: c015f336c8ae21713b1c170c813f69efd0b6d73c
ci Typecheck (affected) 2026-05-25T18:56:46.9231160Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-25T18:56:46.9231504Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T18:56:46.9780959Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-25T18:56:47.2503412Z
ci Typecheck (affected) 2026-05-25T18:56:47.2507988Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mab6e0624036fca26c564c66eec74d171c8ba5d2d[22m[39m
ci Typecheck (affected) 2026-05-25T18:56:47.2509439Z
ci Typecheck (affected) 2026-05-25T18:56:47.2509625Z
ci Typecheck (affected) 2026-05-25T18:56:47.2511691Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1mc015f336c8ae21713b1c170c813f69efd0b6d73c[22m[39m
ci Typecheck (affected) 2026-05-25T18:56:47.2513153Z
ci Typecheck (affected) 2026-05-25T18:56:47.8190376Z
ci Typecheck (affected) 2026-05-25T18:56:47.8192294Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 12 projects and [1m8[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-25T18:56:47.8193080Z
ci Typecheck (affected) 2026-05-25T18:56:47.8193282Z [2m-[22m agent
ci Typecheck (affected) 2026-05-25T18:56:47.8193808Z [2m-[22m shell
ci Typecheck (affected) 2026-05-25T18:56:47.8194161Z [2m-[22m loop
ci Typecheck (affected) 2026-05-25T18:56:47.8194507Z [2m-[22m content
ci Typecheck (affected) 2026-05-25T18:56:47.8194782Z [2m-[22m core
ci Typecheck (affected) 2026-05-25T18:56:47.8195003Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-25T18:56:47.8195341Z [2m-[22m engine
ci Typecheck (affected) 2026-05-25T18:56:47.8195579Z [2m-[22m types
ci Typecheck (affected) 2026-05-25T18:56:47.8195849Z [2m-[22m adapter-codex
ci Typecheck (affected) 2026-05-25T18:56:47.8196662Z [2m-[22m cli-args
ci Typecheck (affected) 2026-05-25T18:56:47.8197119Z [2m-[22m context
ci Typecheck (affected) 2026-05-25T18:56:47.8197482Z [2m-[22m workflow
ci Typecheck (affected) 2026-05-25T18:56:47.8197680Z
ci Typecheck (affected) 2026-05-25T18:56:47.8197862Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-25T18:56:49.6084378Z
ci Typecheck (affected) 2026-05-25T18:56:49.6085813Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-25T18:56:49.6086212Z
ci Typecheck (affected) 2026-05-25T18:56:49.6086527Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-25T18:56:49.6086764Z
ci Typecheck (affected) 2026-05-25T18:56:50.7366631Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T18:56:50.7367747Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-25T18:56:50.7368176Z
ci Typecheck (affected) 2026-05-25T18:56:50.7368608Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-25T18:56:50.7368996Z
ci Typecheck (affected) 2026-05-25T18:56:51.8064858Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T18:56:51.8066282Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-25T18:56:51.8066713Z
ci Typecheck (affected) 2026-05-25T18:56:51.8067147Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-25T18:56:51.8067526Z
ci Typecheck (affected) 2026-0
…[truncated 9262 chars]

```

```

## Manual Testing

- [x] Run `bun test packages/core/src/__tests__/openspec-phase.test.ts` and confirm all 82 tests pass — covers `deriveOpenSpecPhase`, `countOpenFindings`, `phasePipeline`, and `shouldShowPhasePipeline` with the new `"review"` phase.
- [x] Run `bun test packages/core/src/__tests__/loop.test.ts` and confirm all 40 tests pass — covers review-phase prompt injection when enabled and address-findings block when open findings exist.
- [x] Run `bun test packages/engine/src/__tests__/agents.test.ts` and confirm all 23 tests pass — covers `buildClaudeArgs` skipping `--resume` for `reviewerContextStrategy: "fresh"` and applying `reviewerModel` override.
- [x] Run `bun test apps/agent/src/agent/linear-sync/__tests__/review-comment.test.ts` and confirm all 7 tests pass — covers `formatReviewRoundComment` for findings / no-findings / cap-reached cases.
- [x] Run `bun test packages/workflow/src/__tests__/workflow.test.ts` and confirm all 38 tests pass — covers `openspec.reviewPhase` config parsing, defaults, and unknown-key rejection.
- [x] Verify `deriveOpenSpecPhase` backward-compat: call it directly in a REPL (`bun -e "import { deriveOpenSpecPhase } from './packages/core/src/openspec/phase.ts'; console.log(deriveOpenSpecPhase({ proposal: 'x', design: 'x', tasks: '- [x] done', reviewFindings: null, reviewRounds: 0, maxReviewRounds: 0 }))"`) and confirm it prints `done` (feature-disabled path).
- [x] Verify `countOpenFindings` sentinel handling: run `bun -e "import { countOpenFindings } from './packages/core/src/openspec/phase.ts'; console.log(countOpenFindings('## Open\n\n(no findings — close round)\n'))"` and confirm it prints `0`.
- [x] Verify `countOpenFindings` ignores checked items: run `bun -e "import { countOpenFindings } from './packages/core/src/openspec/phase.ts'; console.log(countOpenFindings('## Open\n\n- [x] Fixed\n- [ ] Still open\n'))"` and confirm it prints `1`.
- [x] Verify `StateSchema` accepts old state without `reviewRounds`: run `bun -e "import { StateSchema } from './packages/types/src/types.ts'; const n = new Date().toISOString(); const s = StateSchema.parse({ version: '2', name: 'x', prompt: 'y', engine: 'claude', model: 'm', status: 'active', iteration: 0, usage: { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }, history: [], lastModified: n, createdAt: n, createPr: false }); console.log(s.reviewRounds)"` and confirm it prints `0`.
- [x] Run `bunx nx run agent:typecheck` and confirm it exits 0 — validates that AgentMode's `openspecPhase: "review"` path compiles without error (the `reviewRounds` field on `WorkerMeta` and the `maxReviewRounds: 999` heuristic read from state).
