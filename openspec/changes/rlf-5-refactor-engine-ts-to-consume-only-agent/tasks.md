## Fix failing CI checks (2026-05-14T18:25:57.390Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25877721243 ---
ci Format check (affected) ﻿2026-05-14T18:25:04.0066235Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-14T18:25:04.0066524Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-14T18:25:04.0086930Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-14T18:25:04.0087200Z env:
ci Format check (affected) 2026-05-14T18:25:04.0087441Z NX_BASE: ba3ce3306a1881d4ae43a776ff7cb12db67d9a3c
ci Format check (affected) 2026-05-14T18:25:04.0087773Z NX_HEAD: cd24f468ae13d65f44c23402b757775d5f867ebd
ci Format check (affected) 2026-05-14T18:25:04.0088075Z ##[endgroup]
ci Format check (affected) 2026-05-14T18:25:04.0144662Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-14T18:25:04.2139992Z
ci Format check (affected) 2026-05-14T18:25:04.2144283Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mba3ce3306a1881d4ae43a776ff7cb12db67d9a3c[22m[39m
ci Format check (affected) 2026-05-14T18:25:04.2145558Z
ci Format check (affected) 2026-05-14T18:25:04.2145574Z
ci Format check (affected) 2026-05-14T18:25:04.2147402Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1mcd24f468ae13d65f44c23402b757775d5f867ebd[22m[39m
ci Format check (affected) 2026-05-14T18:25:04.2148695Z
ci Format check (affected) 2026-05-14T18:25:04.5265230Z
ci Format check (affected) 2026-05-14T18:25:04.5266476Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 9 projects:[39m
ci Format check (affected) 2026-05-14T18:25:04.5267144Z
ci Format check (affected) 2026-05-14T18:25:04.5267423Z [2m-[22m engine
ci Format check (affected) 2026-05-14T18:25:04.5267803Z [2m-[22m agent
ci Format check (affected) 2026-05-14T18:25:04.5268206Z [2m-[22m shell
ci Format check (affected) 2026-05-14T18:25:04.5268534Z [2m-[22m loop
ci Format check (affected) 2026-05-14T18:25:04.5269076Z [2m-[22m types
ci Format check (affected) 2026-05-14T18:25:04.5269492Z [2m-[22m cli-args
ci Format check (affected) 2026-05-14T18:25:04.5269902Z [2m-[22m context
ci Format check (affected) 2026-05-14T18:25:04.5270262Z [2m-[22m core
ci Format check (affected) 2026-05-14T18:25:04.5270617Z [2m-[22m mcp
ci Format check (affected) 2026-05-14T18:25:04.5270803Z
ci Format check (affected) 2026-05-14T18:25:04.5270991Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-14T18:25:04.7233388Z
ci Format check (affected) 2026-05-14T18:25:04.7235376Z ##[group]✅ [2m> [22m[2mnx run[22m types:"fmt:check"
ci Format check (affected) 2026-05-14T18:25:04.7235805Z
ci Format check (affected) 2026-05-14T18:25:04.7236232Z [2m> [22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-14T18:25:04.7236625Z
ci Format check (affected) 2026-05-14T18:25:04.7236800Z Checking formatting...
ci Format check (affected) 2026-05-14T18:25:04.7237140Z
ci Format check (affected) 2026-05-14T18:25:04.7237484Z All matched files use the correct format.
ci Format check (affected) 2026-05-14T18:25:04.7238148Z Finished in 66ms on 2 files using 4 threads.
ci Format check (affected) 2026-05-14T18:25:04.7277608Z ##[endgroup]
ci Format check (affected) 2026-05-14T18:25:04.7278574Z ##[group]✅ [2m> [22m[2mnx run[22m core:"fmt:check"
ci Format check (affected) 2026-05-14T18:25:04.7279126Z
ci Format check (affected) 2026-05-14T18:25:04.7279537Z [2m> [22moxfmt --check packages/core/src
ci Format check (affected) 2026-05-14T18:25:04.7279859Z
ci Format check (affected) 2026-05-14T18:25:04.7280038Z Checking formatting...
ci Format check (affected) 2026-05-14T18:25:04.7280266Z
ci Format check (affected) 2026-05-14T18:25:04.7280520Z All matched files use the correct format.
ci Format check (affected) 2026-05-14T18:25:04.7281118Z Finished in 50ms on 19 files using 4 threads.
ci Format check
…[truncated 87620 chars]

```

```
