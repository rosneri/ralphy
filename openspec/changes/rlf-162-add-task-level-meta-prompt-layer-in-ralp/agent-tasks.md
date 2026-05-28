## Resolve PR merge conflicts (2026-05-28T07:49:05.825Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has merge conflicts with `main`.
Steps:
1. `git fetch origin main` then merge `main` into the current branch (`git merge origin/main`). Do NOT rebase.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution as a new merge commit. Do NOT amend existing commits.
4. Push the resolved branch with `git push origin ralph/rlf-162`. Never force-push.
   The post-task harness will NOT push for you in conflict-fix mode — you own the push.
   If the push is rejected, inspect the rejection output and react inline before retrying:
     - **non-fast-forward** (someone else pushed to `ralph/rlf-162`):
       `git fetch origin ralph/rlf-162` then `git merge origin/ralph/rlf-162` to bring their
       changes in as a new merge commit, re-resolve any new conflicts, and retry the push.
       Do NOT rebase and do NOT `--force` / `--force-with-lease` — work on the remote must
       never be overwritten.
     - **pre-push hook failure** (lint, typecheck, tests): fix the underlying problem locally,
       `git add` + `git commit` as a new commit (NEVER `--amend` an existing commit),
       then retry the push.
     - **ref-update policy rejection** (branch protection, required reviews): log the rejection
       message and stop — this requires human intervention; do not force past it.
   Only stop after exhausting the in-context fix. The push must succeed before this iteration ends.

PR: https://github.com/rosneri/ralphy/pull/293
```

## Fix failing CI checks (2026-05-28T06:55:32.009Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has failing CI checks.
Steps:
1. Inspect the failing checks: `gh pr checks https://github.com/rosneri/ralphy/pull/293` then
   `gh run view <run-id> --log-failed` for each red run.
2. Fix the underlying failures in the worktree (tests, lint, typecheck, build).
3. Stage and commit the fixes.
4. Push with `git push origin ralph/rlf-162`. If the push is rejected as
   non-fast-forward, `git fetch origin ralph/rlf-162` then `git merge origin/ralph/rlf-162`
   before retrying. Do NOT rebase, do NOT amend, and never force-push.
5. Wait for CI to re-run; if checks are still red, repeat from step 1.
   Stop only when CI is green or when the failure is clearly outside the change's scope
   (flaky infra, external service down) — in that case, log the rejection and exit.

PR: https://github.com/rosneri/ralphy/pull/293
```

## Fix failing CI checks (2026-05-28T06:17:09.899Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

## Manual Testing

- [x] Run `bun run test --filter meta-prompt` in packages/core and verify all 27 unit tests pass
- [x] Run `bunx openspec validate rlf-162-add-task-level-meta-prompt-layer-in-ralp` and verify no validation errors
- [x] Verify `buildMetaPrompt` output format by running a quick Bun script: import the function, call it with a sample state and each phase, and confirm the preamble contains the change name, engine/model, phase, and iteration number
- [x] Verify opt-out: call `buildMetaPrompt` with `{ enabled: false }` and confirm the result is exactly `""`
- [x] Verify `buildPhasePrompt` integration by running the loop tests: `bun run test --filter loop` in packages/core — confirm meta-prompt prepend and opt-out scenarios pass
- [x] Run `bun run typecheck` across all affected packages (core, loop, workflow) and confirm no type errors
- [x] Verify all 4 phases generate distinct guidance text: run a Bun script calling `buildMetaPrompt` for research/plan/execute/review phases and confirm each has unique phase-specific instructions
- [x] Verify budget zero-handling: call `buildMetaPrompt` with `maxIterations: 0`, `maxCostUsd: 0`, and `maxRuntimeMinutes: 0` — confirm none of those lines appear in the output
- [x] Verify 1-based iteration display: call `buildMetaPrompt` with `state.iteration = 0` and confirm output shows `**Iteration:** 1`
- [x] Verify Active Flags section absent when no flags set: call `buildMetaPrompt` with no runtime flag options and confirm `### Active Flags` section does not appear in output
- [x] Verify Linear issue display: call with `linearIssueIdentifier: "RLF-162"` (no URL) and confirm no "(undefined)" in output; then call with both identifier and URL and confirm URL appears
- [x] Run full build: `bun run build:ci` from repo root and confirm all affected packages compile cleanly

```
CI is failing on this PR. Investigate and fix:

```

--- run 26558197873 ---
ci Typecheck (affected) ﻿2026-05-28T06:16:21.2340935Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T06:16:21.2341244Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T06:16:21.2356985Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T06:16:21.2357262Z env:
ci Typecheck (affected) 2026-05-28T06:16:21.2357504Z NX_BASE: ad6af0233eccc19c091b637be00ff61767553d52
ci Typecheck (affected) 2026-05-28T06:16:21.2357830Z NX_HEAD: e2a6f2dd3856e5f2392b0df3ddebb213998da352
ci Typecheck (affected) 2026-05-28T06:16:21.2358162Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T06:16:21.2358426Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:21.2540793Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T06:16:21.4867705Z
ci Typecheck (affected) 2026-05-28T06:16:21.4872546Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mad6af0233eccc19c091b637be00ff61767553d52[22m[39m
ci Typecheck (affected) 2026-05-28T06:16:21.4873940Z
ci Typecheck (affected) 2026-05-28T06:16:21.4873956Z
ci Typecheck (affected) 2026-05-28T06:16:21.4875737Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1me2a6f2dd3856e5f2392b0df3ddebb213998da352[22m[39m
ci Typecheck (affected) 2026-05-28T06:16:21.4877036Z
ci Typecheck (affected) 2026-05-28T06:16:21.9085447Z
ci Typecheck (affected) 2026-05-28T06:16:21.9087270Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 6 projects and [1m14[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T06:16:21.9088046Z
ci Typecheck (affected) 2026-05-28T06:16:21.9088270Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T06:16:21.9088610Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T06:16:21.9088914Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T06:16:21.9089218Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T06:16:21.9089530Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T06:16:21.9089898Z [2m-[22m workflow
ci Typecheck (affected) 2026-05-28T06:16:21.9090098Z
ci Typecheck (affected) 2026-05-28T06:16:21.9090322Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T06:16:23.6469596Z
ci Typecheck (affected) 2026-05-28T06:16:23.6471309Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T06:16:23.6471935Z
ci Typecheck (affected) 2026-05-28T06:16:23.6472369Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:23.6472726Z
ci Typecheck (affected) 2026-05-28T06:16:24.6583268Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:24.6584354Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T06:16:24.6584725Z
ci Typecheck (affected) 2026-05-28T06:16:24.6585132Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:24.6585492Z
ci Typecheck (affected) 2026-05-28T06:16:25.7124994Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:25.7125700Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T06:16:25.7125960Z
ci Typecheck (affected) 2026-05-28T06:16:25.7126231Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:26.6813925Z
ci Typecheck (affected) 2026-05-28T06:16:26.6814821Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:26.6815791Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-28T06:16:26.6816165Z
ci Typecheck (affected) 2026-05-28T06:16:26.6816589Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:26.6816916Z
ci Typecheck (affected) 2026-05-28T06:16:27.5907389Z ##[endgroup]
ci Typecheck (a
…[truncated 8691 chars]

```

```
