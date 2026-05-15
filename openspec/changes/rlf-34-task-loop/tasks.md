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
