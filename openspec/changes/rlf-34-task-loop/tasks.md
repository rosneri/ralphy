## Fix failing CI checks (2026-05-15T13:18:24.414Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25919852899 ---
ci Typecheck (affected) ﻿2026-05-15T13:16:39.2063917Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-15T13:16:39.2064255Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-15T13:16:39.2087077Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-15T13:16:39.2087348Z env:
ci Typecheck (affected) 2026-05-15T13:16:39.2087605Z NX_BASE: aee337aaee6ad020090349a9fd861049cfbbc763
ci Typecheck (affected) 2026-05-15T13:16:39.2087968Z NX_HEAD: 25600a2a9c5fd464e3233755de7b78c247b01499
ci Typecheck (affected) 2026-05-15T13:16:39.2088331Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-15T13:16:39.2088626Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T13:16:39.2153624Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-15T13:16:39.4803745Z
ci Typecheck (affected) 2026-05-15T13:16:39.4807462Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1maee337aaee6ad020090349a9fd861049cfbbc763[22m[39m
ci Typecheck (affected) 2026-05-15T13:16:39.4808294Z
ci Typecheck (affected) 2026-05-15T13:16:39.4808302Z
ci Typecheck (affected) 2026-05-15T13:16:39.4809322Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m25600a2a9c5fd464e3233755de7b78c247b01499[22m[39m
ci Typecheck (affected) 2026-05-15T13:16:39.4810079Z
ci Typecheck (affected) 2026-05-15T13:16:39.8574602Z
ci Typecheck (affected) 2026-05-15T13:16:39.8576783Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 3 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-15T13:16:39.8577299Z
ci Typecheck (affected) 2026-05-15T13:16:39.8577432Z [2m-[22m agent
ci Typecheck (affected) 2026-05-15T13:16:39.8577705Z [2m-[22m shell
ci Typecheck (affected) 2026-05-15T13:16:39.8577955Z [2m-[22m loop
ci Typecheck (affected) 2026-05-15T13:16:39.8578096Z
ci Typecheck (affected) 2026-05-15T13:16:39.8578231Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-15T13:16:41.5661940Z
ci Typecheck (affected) 2026-05-15T13:16:41.5663905Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-15T13:16:41.5664373Z
ci Typecheck (affected) 2026-05-15T13:16:41.5664867Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-15T13:16:41.5665285Z
ci Typecheck (affected) 2026-05-15T13:16:42.7579737Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T13:16:42.7580885Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-15T13:16:42.7581366Z
ci Typecheck (affected) 2026-05-15T13:16:42.7581965Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-15T13:16:42.7582385Z
ci Typecheck (affected) 2026-05-15T13:16:43.9604575Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T13:16:43.9605646Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-15T13:16:43.9605989Z
ci Typecheck (affected) 2026-05-15T13:16:43.9606382Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-15T13:16:43.9606642Z
ci Typecheck (affected) 2026-05-15T13:16:45.0202023Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T13:16:45.0203172Z ##[group]✅ [2m> [22m[2mnx run[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-15T13:16:45.0203641Z
ci Typecheck (affected) 2026-05-15T13:16:45.0204094Z [2m> [22mtsc -b packages/telemetry/tsconfig.json
ci Typecheck (affected) 2026-05-15T13:16:45.0204479Z
ci Typecheck (affected) 2026-05-15T13:16:46.0472967Z ##[endgroup]
ci Typecheck (affected) 2026-05-15T13:16:46.0474132Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-15T13:16:46.0474568Z
ci Typecheck (affected) 2026-05-15T13:16:46.0475060Z [2m>
…[truncated 7718 chars]

```

```

## Fix failing CI checks (2026-05-15T13:15:05.992Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25919702106 ---
ci Format check (affected) ﻿2026-05-15T13:13:12.9140689Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-15T13:13:12.9141004Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-15T13:13:12.9163422Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-15T13:13:12.9163700Z env:
ci Format check (affected) 2026-05-15T13:13:12.9163963Z NX_BASE: aee337aaee6ad020090349a9fd861049cfbbc763
ci Format check (affected) 2026-05-15T13:13:12.9164329Z NX_HEAD: 00202bee5e25ea7aec90fd6aed2293b99091671c
ci Format check (affected) 2026-05-15T13:13:12.9164639Z ##[endgroup]
ci Format check (affected) 2026-05-15T13:13:12.9229688Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-15T13:13:13.1514403Z
ci Format check (affected) 2026-05-15T13:13:13.1518896Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1maee337aaee6ad020090349a9fd861049cfbbc763[22m[39m
ci Format check (affected) 2026-05-15T13:13:13.1520233Z
ci Format check (affected) 2026-05-15T13:13:13.1520247Z
ci Format check (affected) 2026-05-15T13:13:13.1522025Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m00202bee5e25ea7aec90fd6aed2293b99091671c[22m[39m
ci Format check (affected) 2026-05-15T13:13:13.1523319Z
ci Format check (affected) 2026-05-15T13:13:13.5231559Z
ci Format check (affected) 2026-05-15T13:13:13.5233024Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 3 projects:[39m
ci Format check (affected) 2026-05-15T13:13:13.5233624Z
ci Format check (affected) 2026-05-15T13:13:13.5233851Z [2m-[22m agent
ci Format check (affected) 2026-05-15T13:13:13.5234253Z [2m-[22m shell
ci Format check (affected) 2026-05-15T13:13:13.5234636Z [2m-[22m loop
ci Format check (affected) 2026-05-15T13:13:13.5234842Z
ci Format check (affected) 2026-05-15T13:13:13.5235056Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-15T13:13:13.7511378Z
ci Format check (affected) 2026-05-15T13:13:13.7512617Z ##[group]❌ [2m> [22m[2mnx run[22m loop:"fmt:check"
ci Format check (affected) 2026-05-15T13:13:13.7512907Z
ci Format check (affected) 2026-05-15T13:13:13.7513465Z [2m> [22moxfmt --check apps/loop/src
ci Format check (affected) 2026-05-15T13:13:13.7513742Z
ci Format check (affected) 2026-05-15T13:13:13.7513914Z Checking formatting...
ci Format check (affected) 2026-05-15T13:13:13.7514125Z
ci Format check (affected) 2026-05-15T13:13:13.7514418Z apps/loop/src/**tests**/TaskLoop.test.tsx (16ms)
ci Format check (affected) 2026-05-15T13:13:13.7514782Z
ci Format check (affected) 2026-05-15T13:13:13.7515222Z Format issues found in above 1 files. Run without `--check` to fix.
ci Format check (affected) 2026-05-15T13:13:13.7515898Z Finished in 71ms on 24 files using 4 threads.
ci Format check (affected) 2026-05-15T13:13:13.7596025Z Warning: command "oxfmt --check apps/loop/src" exited with non-zero status code::endgroup::
ci Format check (affected) 2026-05-15T13:13:13.7597694Z ##[group]✅ [2m> [22m[2mnx run[22m shell:"fmt:check"
ci Format check (affected) 2026-05-15T13:13:13.7598168Z
ci Format check (affected) 2026-05-15T13:13:13.7598517Z [2m> [22moxfmt --check apps/shell/src
ci Format check (affected) 2026-05-15T13:13:13.7598816Z
ci Format check (affected) 2026-05-15T13:13:13.7599007Z Checking formatting...
ci Format check (affected) 2026-05-15T13:13:13.7599242Z
ci Format check (affected) 2026-05-15T13:13:13.7599416Z All matched files use the correct format.
ci Format check (affected) 2026-05-15T13:13:13.7599800Z Finished in 93ms on 1 files using 4 threads.
ci Format check (affected) 2026-05-15T13:13:13.7606878Z ##[endgroup]
ci Format check (affected) 2026-05-15T13:13:13.7607501Z ##[group]✅ [2m> [22m[2mnx run[22m agent:"fmt:check"
ci Format check (
…[truncated 13137 chars]

```

```
