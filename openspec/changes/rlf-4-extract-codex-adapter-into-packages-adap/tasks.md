## Fix failing CI checks (2026-05-14T18:44:11.351Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25878598708 ---
ci Format check (affected) ﻿2026-05-14T18:42:21.2772455Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-14T18:42:21.2772760Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-14T18:42:21.2809208Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-14T18:42:21.2809486Z env:
ci Format check (affected) 2026-05-14T18:42:21.2809736Z NX_BASE: ba3ce3306a1881d4ae43a776ff7cb12db67d9a3c
ci Format check (affected) 2026-05-14T18:42:21.2810101Z NX_HEAD: 8163cf6f993bdda38848c67e60c6f0af50c7f154
ci Format check (affected) 2026-05-14T18:42:21.2810402Z ##[endgroup]
ci Format check (affected) 2026-05-14T18:42:21.2890311Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-14T18:42:21.5308121Z
ci Format check (affected) 2026-05-14T18:42:21.5313137Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mba3ce3306a1881d4ae43a776ff7cb12db67d9a3c[22m[39m
ci Format check (affected) 2026-05-14T18:42:21.5314515Z
ci Format check (affected) 2026-05-14T18:42:21.5314527Z
ci Format check (affected) 2026-05-14T18:42:21.5316361Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m8163cf6f993bdda38848c67e60c6f0af50c7f154[22m[39m
ci Format check (affected) 2026-05-14T18:42:21.5317703Z
ci Format check (affected) 2026-05-14T18:42:21.8962835Z
ci Format check (affected) 2026-05-14T18:42:21.8964201Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 18 projects:[39m
ci Format check (affected) 2026-05-14T18:42:21.8964731Z
ci Format check (affected) 2026-05-14T18:42:21.8964893Z [2m-[22m adapter-codex
ci Format check (affected) 2026-05-14T18:42:21.8965201Z [2m-[22m engine
ci Format check (affected) 2026-05-14T18:42:21.8965441Z [2m-[22m agent
ci Format check (affected) 2026-05-14T18:42:21.8965673Z [2m-[22m shell
ci Format check (affected) 2026-05-14T18:42:21.8965890Z [2m-[22m loop
ci Format check (affected) 2026-05-14T18:42:21.8966147Z [2m-[22m change-store
ci Format check (affected) 2026-05-14T18:42:21.8966420Z [2m-[22m openspec
ci Format check (affected) 2026-05-14T18:42:21.8966661Z [2m-[22m mcp
ci Format check (affected) 2026-05-14T18:42:21.8966900Z [2m-[22m telemetry
ci Format check (affected) 2026-05-14T18:42:21.8967152Z [2m-[22m cli-args
ci Format check (affected) 2026-05-14T18:42:21.8967391Z [2m-[22m content
ci Format check (affected) 2026-05-14T18:42:21.8967614Z [2m-[22m core
ci Format check (affected) 2026-05-14T18:42:21.8967843Z [2m-[22m context
ci Format check (affected) 2026-05-14T18:42:21.8968077Z [2m-[22m version
ci Format check (affected) 2026-05-14T18:42:21.8968319Z [2m-[22m output
ci Format check (affected) 2026-05-14T18:42:21.8968870Z [2m-[22m paths
ci Format check (affected) 2026-05-14T18:42:21.8969332Z [2m-[22m types
ci Format check (affected) 2026-05-14T18:42:21.8969548Z [2m-[22m log
ci Format check (affected) 2026-05-14T18:42:21.8969668Z
ci Format check (affected) 2026-05-14T18:42:21.8969800Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-14T18:42:22.1045521Z
ci Format check (affected) 2026-05-14T18:42:22.1047235Z ##[group]✅ [2m> [22m[2mnx run[22m types:"fmt:check"
ci Format check (affected) 2026-05-14T18:42:22.1049647Z
ci Format check (affected) 2026-05-14T18:42:22.1050552Z [2m> [22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-14T18:42:22.1051139Z
ci Format check (affected) 2026-05-14T18:42:22.1051487Z Checking formatting...
ci Format check (affected) 2026-05-14T18:42:22.1051883Z
ci Format check (affected) 2026-05-14T18:42:22.1052319Z All matched files use the correct format.
ci Format check (affected) 2026-05-14T18:42:22.1053106Z Finished in 37ms on 2 files using 4 threads.
ci Format check (affected) 2026-05-14T18:42:22.1103681Z ##[end
…[truncated 16948 chars]

```

```
