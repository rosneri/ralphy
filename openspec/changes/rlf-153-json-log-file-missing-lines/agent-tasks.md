## Fix failing CI checks (2026-05-26T03:27:15.358Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26430447754 ---
ci Typecheck (affected) ﻿2026-05-26T03:25:59.6782295Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-26T03:25:59.6782643Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-26T03:25:59.6817477Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-26T03:25:59.6817765Z env:
ci Typecheck (affected) 2026-05-26T03:25:59.6818030Z NX_BASE: 62769f6b18b85daa50802680c5031e8b585b2044
ci Typecheck (affected) 2026-05-26T03:25:59.6818410Z NX_HEAD: 85eecac901b0e332d104dd1316de6ae052a37498
ci Typecheck (affected) 2026-05-26T03:25:59.6818811Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-26T03:25:59.6819144Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T03:25:59.6963243Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-26T03:25:59.9643014Z
ci Typecheck (affected) 2026-05-26T03:25:59.9647316Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m62769f6b18b85daa50802680c5031e8b585b2044[22m[39m
ci Typecheck (affected) 2026-05-26T03:25:59.9648671Z
ci Typecheck (affected) 2026-05-26T03:25:59.9648684Z
ci Typecheck (affected) 2026-05-26T03:25:59.9650743Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m85eecac901b0e332d104dd1316de6ae052a37498[22m[39m
ci Typecheck (affected) 2026-05-26T03:25:59.9652166Z
ci Typecheck (affected) 2026-05-26T03:26:00.4574119Z
ci Typecheck (affected) 2026-05-26T03:26:00.4575980Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 4 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-26T03:26:00.4576777Z
ci Typecheck (affected) 2026-05-26T03:26:00.4577001Z [2m-[22m log
ci Typecheck (affected) 2026-05-26T03:26:00.4577742Z [2m-[22m agent
ci Typecheck (affected) 2026-05-26T03:26:00.4578149Z [2m-[22m shell
ci Typecheck (affected) 2026-05-26T03:26:00.4578547Z [2m-[22m loop
ci Typecheck (affected) 2026-05-26T03:26:00.4578759Z
ci Typecheck (affected) 2026-05-26T03:26:00.4578999Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-26T03:26:02.1804627Z
ci Typecheck (affected) 2026-05-26T03:26:02.1805892Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-26T03:26:02.1806202Z
ci Typecheck (affected) 2026-05-26T03:26:02.1806523Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-26T03:26:02.1806787Z
ci Typecheck (affected) 2026-05-26T03:26:03.1898568Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T03:26:03.1899424Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-26T03:26:03.1899758Z
ci Typecheck (affected) 2026-05-26T03:26:03.1900267Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-26T03:26:03.1900737Z
ci Typecheck (affected) 2026-05-26T03:26:04.3025089Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T03:26:04.3026233Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-26T03:26:04.3026684Z
ci Typecheck (affected) 2026-05-26T03:26:04.3027134Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-26T03:26:04.3027523Z
ci Typecheck (affected) 2026-05-26T03:26:05.3560794Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T03:26:05.3561996Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-26T03:26:05.3562439Z
ci Typecheck (affected) 2026-05-26T03:26:05.3562896Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-26T03:26:05.3563283Z
ci Typecheck (affected) 2026-05-26T03:26:06.4212636Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T03:26:06.4213518Z ##[group]✅ [2m> [22m[2mnx run[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-26T03:26:06.42
…[truncated 7453 chars]

```

```

## Resolve PR merge conflicts (2026-05-26T03:23:45.761Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has merge conflicts with `main`.
Steps:
1. `git fetch origin main` then rebase or merge `main` into the current branch.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution.
4. Push the resolved branch with `git push --force-with-lease origin ralph/rlf-153`.
   The post-task harness will NOT push for you in conflict-fix mode — you own the push.
   If the push is rejected, inspect the rejection output and react inline before retrying:
     - **stale lease / non-fast-forward** (`stale info`, someone else pushed to `ralph/rlf-153`):
       `git fetch origin ralph/rlf-153` then rebase/merge their changes in, re-resolve any new
       conflicts, and retry the push.
     - **pre-push hook failure** (lint, typecheck, tests): fix the underlying problem locally,
       `git add` + `git commit --amend` (or a new fixup commit), then retry the push.
     - **ref-update policy rejection** (branch protection, required reviews): log the rejection
       message and stop — this requires human intervention; do not force past it.
   Only stop after exhausting the in-context fix. The push must succeed before this iteration ends.

PR: https://github.com/NeriRos/ralphy/pull/255
```
