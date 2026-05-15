# Tasks for RLF-41

## Fix failing CI checks (2026-05-15T15:45:50.439Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

Resolution: the `pending-tasks.test.ts` case "keeps a freshly prepended Fix failing CI task on top" piped a tasks.md with a `## Fix failing CI checks` heading through `parseSubtasks`, but `parseSubtasks` intentionally skips flow-task sections (see its doc comment), so the prepended fix-task line was dropped and `ordered[0]` ended up being `previous unfinished mission task`. Rewrote the test to place both unchecked items under a regular `## Implementation` heading so the assertion exercises the cap-15 ordering invariant without colliding with parseSubtasks' flow-skip behavior.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25926948095 ---
ci Test affected files + coverage ﻿2026-05-15T15:44:42.4713782Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-15T15:44:42.4714106Z ^[[36;1mbun run test:affected-files:coverage:ci^[[0m
ci Test affected files + coverage 2026-05-15T15:44:42.4743180Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-15T15:44:42.4743392Z env:
ci Test affected files + coverage 2026-05-15T15:44:42.4743586Z NX_BASE: dd78ae711c17994588d68bf56b0b8aa0d5c8f709
ci Test affected files + coverage 2026-05-15T15:44:42.4743857Z NX_HEAD: 59cecba9540be60cae39376479f7dd33b481e16f
ci Test affected files + coverage 2026-05-15T15:44:42.4744089Z ##[endgroup]
ci Test affected files + coverage 2026-05-15T15:44:42.4806540Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-15T15:44:42.4999148Z Detecting affected projects...
ci Test affected files + coverage 2026-05-15T15:44:42.4999448Z
ci Test affected files + coverage 2026-05-15T15:44:43.3600507Z agent: 2 relevant test file(s)
ci Test affected files + coverage 2026-05-15T15:44:43.3600974Z apps/agent/src/**tests**/agent-mode-steering.test.tsx
ci Test affected files + coverage 2026-05-15T15:44:43.3601314Z apps/agent/src/**tests**/pending-tasks.test.ts
ci Test affected files + coverage 2026-05-15T15:44:43.3601501Z
ci Test affected files + coverage 2026-05-15T15:44:43.3613304Z bun test v1.3.14 (0d9b296a)
ci Test affected files + coverage 2026-05-15T15:44:43.3689537Z
ci Test affected files + coverage 2026-05-15T15:44:43.3690216Z ##[group]src/**tests**/wire-setup-worktree.test.ts:
ci Test affected files + coverage 2026-05-15T15:44:43.5003545Z (pass) setupWorktree — RLF-39: worktree creation failure must not fall back to projectRoot > useWorktree:true + createWorktree throws → no scaffold lands in projectRoot, red log emitted [48.75ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5159080Z (pass) setupWorktree — RLF-39: worktree creation failure must not fall back to projectRoot > useWorktree:false preserves projectRoot fallback when no worktree is created [15.59ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5159963Z
ci Test affected files + coverage 2026-05-15T15:44:43.5160445Z ##[endgroup]
ci Test affected files + coverage 2026-05-15T15:44:43.5160608Z
ci Test affected files + coverage 2026-05-15T15:44:43.5160951Z ##[group]src/**tests**/worktree-mcp-seed.test.ts:
ci Test affected files + coverage 2026-05-15T15:44:43.5176513Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.1 copies project .mcp.json into worktree [0.83ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5181807Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.2 rewrites .ralph/ relative args to absolute paths under projectRoot [0.53ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5184713Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.3 no-op when neither project nor worktree has .mcp.json [0.29ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5189801Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.4 worktree's existing .mcp.json takes precedence over project's [0.50ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5194563Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.4 worktree .mcp.json with already-absolute paths is unchanged after seeding [0.46ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5199618Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.5 invalid JSON is skipped without throwing (graceful degradation) [0.50ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5204014Z (pass) seedWorktreeMcpConfig (§1 manual plan) > config without mcpServers map is written through unchanged [0.45ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5209112Z (pass) seedWorktreeMcpConfig (§1 manual plan) > server entry without args array is left intact [0.48ms]
ci Test affected files + coverage 2026-05-15T15:44:43.5209628Z
ci Test affected files + covera
…[truncated 105297 chars]

```

```

## Fix failing CI checks (2026-05-15T15:42:39.645Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

Resolution: `apps/agent/src/__tests__/agent-mode-steering.test.tsx` had a duplicate `createdAt` property on the `fakeWorker.issue` literal (TS1117). The merge in the prior task added the new `createdAt` field without removing the existing one. Removed the older `2026-01-01` entry, keeping the `2026-05-15` value.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25926795005 ---
ci Typecheck (affected) ﻿2026-05-15T15:40:50.5333920Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-15T15:40:50.5334261Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-15T15:40:50.5367345Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-15T15:40:50.5367609Z env:
ci Typecheck (affected) 2026-05-15T15:40:50.5367857Z NX_BASE: dd78ae711c17994588d68bf56b0b8aa0d5c8f709
ci Typecheck (affected) 2026-05-15T15:40:50.5368372Z NX_HEAD: f570b86eb1e4df261e02cd4dd021868d3f02733a
ci Typecheck (affected) 2026-05-15T15:40:50.5368712Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-15T15:40:50.5368993Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T15:40:50.5443163Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-15T15:40:50.8080534Z
ci Typecheck (affected) 2026-05-15T15:40:50.8085206Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1mdd78ae711c17994588d68bf56b0b8aa0d5c8f709^[[22m^[[39m
ci Typecheck (affected) 2026-05-15T15:40:50.8086377Z
ci Typecheck (affected) 2026-05-15T15:40:50.8086387Z
ci Typecheck (affected) 2026-05-15T15:40:50.8087899Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1mf570b86eb1e4df261e02cd4dd021868d3f02733a^[[22m^[[39m
ci Typecheck (affected) 2026-05-15T15:40:50.8088900Z
ci Typecheck (affected) 2026-05-15T15:40:51.2011360Z
ci Typecheck (affected) 2026-05-15T15:40:51.2013445Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 2 projects and ^[[1m16^[[22m tasks they depend on:^[[39m
ci Typecheck (affected) 2026-05-15T15:40:51.2014319Z
ci Typecheck (affected) 2026-05-15T15:40:51.2014538Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-15T15:40:51.2014931Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-15T15:40:51.2015145Z
ci Typecheck (affected) 2026-05-15T15:40:51.2015363Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-15T15:40:53.0169718Z
ci Typecheck (affected) 2026-05-15T15:40:53.0171296Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-15T15:40:53.0171746Z
ci Typecheck (affected) 2026-05-15T15:40:53.0172122Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-15T15:40:53.0172377Z
ci Typecheck (affected) 2026-05-15T15:40:54.1499759Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T15:40:54.1500859Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m output:typecheck
ci Typecheck (affected) 2026-05-15T15:40:54.1501643Z
ci Typecheck (affected) 2026-05-15T15:40:54.1502148Z ^[[2m> ^[[22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-15T15:40:54.1502589Z
ci Typecheck (affected) 2026-05-15T15:40:55.3117517Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T15:40:55.3118612Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m context:typecheck
ci Typecheck (affected) 2026-05-15T15:40:55.3119094Z
ci Typecheck (affected) 2026-05-15T15:40:55.3119588Z ^[[2m> ^[[22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-15T15:40:55.3120035Z
ci Typecheck (affected) 2026-05-15T15:40:56.4237374Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T15:40:56.4238468Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-15T15:40:56.4238921Z
ci Typecheck (affected) 2026-05-15T15:40:56.4239395Z ^[[2m> ^[[22mtsc -b packages/telemetry/tsconfig.json
ci Typecheck (affected) 2026-05-15T15:40:56.4239799Z
ci Typecheck (affected) 2026-05-15T15:40:57.4877422Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T15:40:57.4878483Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m version:typecheck
ci Typecheck (affected) 2026-05-15T15:40:57.4878909Z
ci Typecheck (affected) 2026-05-15T15:40:57.4879377Z ^[[2
…[truncated 116759 chars]

```

```

## Resolve PR merge conflicts (2026-05-15T15:39:38.853Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has merge conflicts with `main`.
Steps:
1. `git fetch origin main` then rebase or merge `main` into the current branch.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution.

PR: https://github.com/NeriRos/ralphy/pull/162
```

## Fix failing CI checks (2026-05-15T14:52:41.065Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

Resolution: merging main brought in the `createdAt` requirement on `LinearIssue` (added in RLF-36) and a new `agent-mode-steering.test.tsx` (added in RLF-35) whose `fakeWorker.issue` literal did not include `createdAt`. The fix is to merge main and add `createdAt` to the `fakeWorker.issue` literal so `apps/agent` typechecks.

## Fix failing CI checks (2026-05-15T14:48:49.927Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25924213382 ---
ci Format check (affected) ﻿2026-05-15T14:47:46.0547243Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-15T14:47:46.0547526Z ^[[36;1mbun run fmt:ci^[[0m
ci Format check (affected) 2026-05-15T14:47:46.0567323Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-15T14:47:46.0567580Z env:
ci Format check (affected) 2026-05-15T14:47:46.0567805Z NX_BASE: c83ee52b2474965d0c0bbb6ee18436ab21ccee62
ci Format check (affected) 2026-05-15T14:47:46.0568137Z NX_HEAD: 02b817feba1575dbaffe824a7ee51406bc4ebc5a
ci Format check (affected) 2026-05-15T14:47:46.0568419Z ##[endgroup]
ci Format check (affected) 2026-05-15T14:47:46.0620665Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-15T14:47:46.2615792Z
ci Format check (affected) 2026-05-15T14:47:46.2620096Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1mc83ee52b2474965d0c0bbb6ee18436ab21ccee62^[[22m^[[39m
ci Format check (affected) 2026-05-15T14:47:46.2621434Z
ci Format check (affected) 2026-05-15T14:47:46.2621479Z
ci Format check (affected) 2026-05-15T14:47:46.2623248Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m02b817feba1575dbaffe824a7ee51406bc4ebc5a^[[22m^[[39m
ci Format check (affected) 2026-05-15T14:47:46.2624723Z
ci Format check (affected) 2026-05-15T14:47:46.6060967Z
ci Format check (affected) 2026-05-15T14:47:46.6062168Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mfmt:check^[[22m for 2 projects:^[[39m
ci Format check (affected) 2026-05-15T14:47:46.6062545Z
ci Format check (affected) 2026-05-15T14:47:46.6062669Z ^[[2m-^[[22m agent
ci Format check (affected) 2026-05-15T14:47:46.6062902Z ^[[2m-^[[22m shell
ci Format check (affected) 2026-05-15T14:47:46.6063032Z
ci Format check (affected) 2026-05-15T14:47:46.6063151Z ^[[2m^[[36m^[[39m^[[22m
ci Format check (affected) 2026-05-15T14:47:46.7560688Z
ci Format check (affected) 2026-05-15T14:47:46.7561897Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m shell:"fmt:check"
ci Format check (affected) 2026-05-15T14:47:46.7562166Z
ci Format check (affected) 2026-05-15T14:47:46.7562407Z ^[[2m> ^[[22moxfmt --check apps/shell/src
ci Format check (affected) 2026-05-15T14:47:46.7562589Z
ci Format check (affected) 2026-05-15T14:47:46.7562704Z Checking formatting...
ci Format check (affected) 2026-05-15T14:47:46.7562851Z
ci Format check (affected) 2026-05-15T14:47:46.7562994Z All matched files use the correct format.
ci Format check (affected) 2026-05-15T14:47:46.7563355Z Finished in 32ms on 1 files using 4 threads.
ci Format check (affected) 2026-05-15T14:47:46.7866929Z ##[endgroup]
ci Format check (affected) 2026-05-15T14:47:46.7867657Z ##[group]❌ ^[[2m> ^[[22m^[[2mnx run^[[22m agent:"fmt:check"
ci Format check (affected) 2026-05-15T14:47:46.7867944Z
ci Format check (affected) 2026-05-15T14:47:46.7868170Z ^[[2m> ^[[22moxfmt --check apps/agent/src
ci Format check (affected) 2026-05-15T14:47:46.7868349Z
ci Format check (affected) 2026-05-15T14:47:46.7868463Z Checking formatting...
ci Format check (affected) 2026-05-15T14:47:46.7868608Z
ci Format check (affected) 2026-05-15T14:47:46.7868784Z apps/agent/src/components/AgentMode.tsx (5ms)
ci Format check (affected) 2026-05-15T14:47:46.7868984Z
ci Format check (affected) 2026-05-15T14:47:46.7869224Z Format issues found in above 1 files. Run without `--check` to fix.
ci Format check (affected) 2026-05-15T14:47:46.7869644Z Finished in 63ms on 41 files using 4 threads.
ci Format check (affected) 2026-05-15T14:47:46.7876118Z Warning: command "oxfmt --check apps/agent/src" exited with non-zero status code::endgroup::
ci Format check (affected) 2026-05-15T14:47:46.7876631Z ^[[2m^[[31m^[[39m^[[22m
ci Format check (affected) 2026-05-15T14:47:46.7876904Z
ci Format ch
…[truncated 12322 chars]

```

```

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-41/ci-failing-checks-subtask-removes-previous-tasks and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Add a spec delta under `specs/agent-mode-subtasks/spec.md` describing the new SUBTASKS-panel ordering requirement
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan

## Implementation

- [x] Add `orderSubtasksForCappedDisplay()` next to `parseSubtasks` in `apps/agent/src/components/AgentMode.tsx` that partitions subtasks into `[pending, done]` (stable file order within each group).
- [x] Use `orderSubtasksForCappedDisplay()` when computing the capped slice in the SUBTASKS panel render. The expanded (`Ctrl+Shift+T`) view still renders subtasks in literal file order.
- [x] Extend `apps/agent/src/__tests__/pending-tasks.test.ts` with cases covering the partition order, empty input, all-pending input, all-done input, and a freshly prepended Fix-failing-CI scenario that simulates 16 completed items above 2 unchecked items and verifies the cap-15 slice keeps both unchecked tasks visible.
- [x] Run `bun run lint` and fix any issues it reports.
- [x] Run `bun run test` and confirm the new tests pass with no regressions and no coverage-threshold reduction.
- [x] Run `bunx openspec validate rlf-41-ci-failing-checks-subtask-removes-previo` and resolve any reported issues.

## Manual Testing

- [x] Run the agent dashboard (`bun run dev` or `ralph agent`) against a worker whose `tasks.md` has accumulated more than 15 completed items above one unchecked item; confirm the SUBTASKS panel shows the unchecked item at row 1 with the `+N more` ellipsis below.
- [x] Trigger a CI failure on an open PR (or hand-craft `tasks.md` to mimic post `prependFixTask("Fix failing CI checks", …)`) and confirm the freshly-added `[ ] Fix failing CI checks…` row appears at the top of the SUBTASKS panel, with prior unchecked mission tasks still visible below it.
- [x] Press `Ctrl+Shift+T` to expand the SUBTASKS panel and confirm the items render in literal file order (no reorder, no cap) — completed items appear interleaved with pending items as they sit in the file.
- [x] Press `Ctrl+T` to collapse the panel and confirm the reorder + cap reappears.
- [x] Edge case: a `tasks.md` with all items completed still renders the panel unchanged (no regression — full list, no ellipsis until past 15 items).
- [x] Edge case: a `tasks.md` with only Planning items renders no SUBTASKS rows (since `parseSubtasks` skips the Planning section).
