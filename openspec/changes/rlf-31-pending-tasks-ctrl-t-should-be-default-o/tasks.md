# Tasks for RLF-31

## Resolve PR merge conflicts (2026-05-15T12:45:13.260Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has merge conflicts with `main`.
Steps:
1. `git fetch origin main` then rebase or merge `main` into the current branch.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution.

PR: https://github.com/NeriRos/ralphy/pull/151
```

## Fix failing CI checks (2026-05-15T12:42:17.169Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25917000163 ---
ci Format check (affected) ﻿2026-05-15T12:09:35.8847418Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-15T12:09:35.8847941Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-15T12:09:35.8868906Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-15T12:09:35.8869165Z env:
ci Format check (affected) 2026-05-15T12:09:35.8869407Z NX_BASE: a4c3d83cfd8d2e0b0d9f496db7c7c47f42019eba
ci Format check (affected) 2026-05-15T12:09:35.8869757Z NX_HEAD: 39371d5076cc0ddc37c8779e738ecb6b7e8a59b5
ci Format check (affected) 2026-05-15T12:09:35.8870061Z ##[endgroup]
ci Format check (affected) 2026-05-15T12:09:35.8929994Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-15T12:09:36.1195618Z
ci Format check (affected) 2026-05-15T12:09:36.1200670Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1ma4c3d83cfd8d2e0b0d9f496db7c7c47f42019eba[22m[39m
ci Format check (affected) 2026-05-15T12:09:36.1202115Z
ci Format check (affected) 2026-05-15T12:09:36.1202128Z
ci Format check (affected) 2026-05-15T12:09:36.1203444Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m39371d5076cc0ddc37c8779e738ecb6b7e8a59b5[22m[39m
ci Format check (affected) 2026-05-15T12:09:36.1204253Z
ci Format check (affected) 2026-05-15T12:09:36.4699666Z
ci Format check (affected) 2026-05-15T12:09:36.4701214Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 2 projects:[39m
ci Format check (affected) 2026-05-15T12:09:36.4701664Z
ci Format check (affected) 2026-05-15T12:09:36.4701830Z [2m-[22m agent
ci Format check (affected) 2026-05-15T12:09:36.4702094Z [2m-[22m shell
ci Format check (affected) 2026-05-15T12:09:36.4702226Z
ci Format check (affected) 2026-05-15T12:09:36.4702361Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-15T12:09:36.6576171Z
ci Format check (affected) 2026-05-15T12:09:36.6577649Z ##[group]✅ [2m> [22m[2mnx run[22m shell:"fmt:check"
ci Format check (affected) 2026-05-15T12:09:36.6578101Z
ci Format check (affected) 2026-05-15T12:09:36.6578572Z [2m> [22moxfmt --check apps/shell/src
ci Format check (affected) 2026-05-15T12:09:36.6578925Z
ci Format check (affected) 2026-05-15T12:09:36.6579133Z Checking formatting...
ci Format check (affected) 2026-05-15T12:09:36.6579395Z
ci Format check (affected) 2026-05-15T12:09:36.6579680Z All matched files use the correct format.
ci Format check (affected) 2026-05-15T12:09:36.6580344Z Finished in 65ms on 1 files using 4 threads.
ci Format check (affected) 2026-05-15T12:09:36.6692074Z ##[endgroup]
ci Format check (affected) 2026-05-15T12:09:36.6692925Z ##[group]❌ [2m> [22m[2mnx run[22m agent:"fmt:check"
ci Format check (affected) 2026-05-15T12:09:36.6693360Z
ci Format check (affected) 2026-05-15T12:09:36.6693729Z [2m> [22moxfmt --check apps/agent/src
ci Format check (affected) 2026-05-15T12:09:36.6694077Z
ci Format check (affected) 2026-05-15T12:09:36.6694269Z Checking formatting...
ci Format check (affected) 2026-05-15T12:09:36.6694530Z
ci Format check (affected) 2026-05-15T12:09:36.6694866Z apps/agent/src/components/AgentMode.tsx (5ms)
ci Format check (affected) 2026-05-15T12:09:36.6695257Z
ci Format check (affected) 2026-05-15T12:09:36.6696091Z Format issues found in above 1 files. Run without `--check` to fix.
ci Format check (affected) 2026-05-15T12:09:36.6696719Z Finished in 81ms on 37 files using 4 threads.
ci Format check (affected) 2026-05-15T12:09:36.6703087Z Warning: command "oxfmt --check apps/agent/src" exited with non-zero status code::endgroup::
ci Format check (affected) 2026-05-15T12:09:36.6704062Z [2m[31m[39m[22m
ci Format check (affected) 2026-05-15T12:09:36.6704303Z
ci Format check (affected) 2026-05-15T12:09:36.6705230Z [7m[1m[31
…[truncated 619 chars]

```

```

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-31/pending-tasks-ctrl-t-should-be-default-on and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan (one `- [ ] task` per discrete unit of work, including tests and `bun run lint` / `bun run test`)

## Implementation

- [x] Replace `parsePendingTasks` in `apps/agent/src/components/AgentMode.tsx` with `parseSubtasks(tasksMd): Array<{ done: boolean; text: string }>` that returns every `- [x]` / `- [ ]` line in document order
- [x] Update `WorkerMeta` to store `subtasks: Array<{ done: boolean; text: string }>` and adjust the initial empty state plus the polling loop assignment so `currentTask` becomes the first item with `done === false`
- [x] Default `showPendingTasks` `useState` to `true` so the SUBTASKS panel is open on launch
- [x] Remove the `│ Ctrl+T tasks …` segment from the worker card header
- [x] Rename the panel header to `SUBTASKS (N)` and append `CTRL+T to close`; render each subtask with `[x] ` (dim) or `[ ] ` (normal) prefix and keep the `MAX_PENDING_DISPLAY` cap
- [x] Move the task progress bar to the bottom of the card and render it only when `showPendingTasks` is false; append a dim `CTRL+T to open` hint after the `#/#` count
- [x] Rewrite `apps/agent/src/__tests__/pending-tasks.test.ts` to cover `parseSubtasks` (ordered done+pending entries, ignores non-task lines, trims whitespace, empty input)
- [x] Run `bun run lint` and fix any findings
- [x] Run `bun run test` and fix any failures
- [x] Run `bunx openspec validate rlf-31-pending-tasks-ctrl-t-should-be-default-o`
