# Tasks for RLF-41

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
