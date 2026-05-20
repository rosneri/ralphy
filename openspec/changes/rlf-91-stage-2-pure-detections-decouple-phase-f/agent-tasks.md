## Fix failing CI checks (2026-05-20T23:22:41.162Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26195650443 ---
ci Format check (affected) ﻿2026-05-20T23:20:48.1866732Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-20T23:20:48.1867051Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-20T23:20:48.1904115Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-20T23:20:48.1904427Z env:
ci Format check (affected) 2026-05-20T23:20:48.1904708Z NX_BASE: 472da4e853609f8424ef4dc667fbd581da90dc96
ci Format check (affected) 2026-05-20T23:20:48.1905089Z NX_HEAD: d6b966dbbb0797f4bf565210e5e0ec0db1910b9e
ci Format check (affected) 2026-05-20T23:20:48.1905398Z ##[endgroup]
ci Format check (affected) 2026-05-20T23:20:48.1994617Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-20T23:20:48.4542691Z
ci Format check (affected) 2026-05-20T23:20:48.4545664Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m472da4e853609f8424ef4dc667fbd581da90dc96[22m[39m
ci Format check (affected) 2026-05-20T23:20:48.4546974Z
ci Format check (affected) 2026-05-20T23:20:48.4546984Z
ci Format check (affected) 2026-05-20T23:20:48.4548056Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1md6b966dbbb0797f4bf565210e5e0ec0db1910b9e[22m[39m
ci Format check (affected) 2026-05-20T23:20:48.4548810Z
ci Format check (affected) 2026-05-20T23:20:48.8371008Z
ci Format check (affected) 2026-05-20T23:20:48.8372660Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 5 projects:[39m
ci Format check (affected) 2026-05-20T23:20:48.8373145Z
ci Format check (affected) 2026-05-20T23:20:48.8373285Z [2m-[22m agent
ci Format check (affected) 2026-05-20T23:20:48.8373547Z [2m-[22m shell
ci Format check (affected) 2026-05-20T23:20:48.8373787Z [2m-[22m core
ci Format check (affected) 2026-05-20T23:20:48.8374019Z [2m-[22m loop
ci Format check (affected) 2026-05-20T23:20:48.8374240Z [2m-[22m mcp
ci Format check (affected) 2026-05-20T23:20:48.8374378Z
ci Format check (affected) 2026-05-20T23:20:48.8374505Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-20T23:20:49.0932765Z
ci Format check (affected) 2026-05-20T23:20:49.0934480Z ##[group]✅ [2m> [22m[2mnx run[22m core:"fmt:check"
ci Format check (affected) 2026-05-20T23:20:49.0934944Z
ci Format check (affected) 2026-05-20T23:20:49.0935387Z [2m> [22moxfmt --check packages/core/src
ci Format check (affected) 2026-05-20T23:20:49.0935754Z
ci Format check (affected) 2026-05-20T23:20:49.0935955Z Checking formatting...
ci Format check (affected) 2026-05-20T23:20:49.0936235Z
ci Format check (affected) 2026-05-20T23:20:49.0936490Z All matched files use the correct format.
ci Format check (affected) 2026-05-20T23:20:49.0937089Z Finished in 66ms on 30 files using 4 threads.
ci Format check (affected) 2026-05-20T23:20:49.1324162Z ##[endgroup]
ci Format check (affected) 2026-05-20T23:20:49.1325339Z ##[group]✅ [2m> [22m[2mnx run[22m loop:"fmt:check"
ci Format check (affected) 2026-05-20T23:20:49.1325785Z
ci Format check (affected) 2026-05-20T23:20:49.1326142Z [2m> [22moxfmt --check apps/loop/src
ci Format check (affected) 2026-05-20T23:20:49.1326477Z
ci Format check (affected) 2026-05-20T23:20:49.1326655Z Checking formatting...
ci Format check (affected) 2026-05-20T23:20:49.1326904Z
ci Format check (affected) 2026-05-20T23:20:49.1327156Z All matched files use the correct format.
ci Format check (affected) 2026-05-20T23:20:49.1327729Z Finished in 118ms on 24 files using 4 threads.
ci Format check (affected) 2026-05-20T23:20:49.1544880Z ##[endgroup]
ci Format check (affected) 2026-05-20T23:20:49.1545974Z ##[group]❌ [2m> [22m[2mnx run[22m agent:"fmt:check"
ci Format check (affected) 2026-05-20T23:20:49.1546389Z
ci Format check (affected) 2026-05-20T23:20:49.1546746Z [2m> [22moxfmt --check
…[truncated 267262 chars]

```

```
