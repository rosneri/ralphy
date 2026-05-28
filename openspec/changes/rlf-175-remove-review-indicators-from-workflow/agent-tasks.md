## Fix failing CI checks (2026-05-28T08:30:26.045Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26563700434 ---
ci Typecheck (affected) ﻿2026-05-28T08:28:40.3556888Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T08:28:40.3557253Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T08:28:40.3583848Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T08:28:40.3584135Z env:
ci Typecheck (affected) 2026-05-28T08:28:40.3584433Z NX_BASE: 3b35ac3189c86e5ae4a4e61aec39a93b50f204aa
ci Typecheck (affected) 2026-05-28T08:28:40.3584814Z NX_HEAD: 19bf31f3f8ef6143b3eaecc21085090af160f6c5
ci Typecheck (affected) 2026-05-28T08:28:40.3585193Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T08:28:40.3585510Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T08:28:40.3650922Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T08:28:40.6212994Z
ci Typecheck (affected) 2026-05-28T08:28:40.6218581Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m3b35ac3189c86e5ae4a4e61aec39a93b50f204aa[22m[39m
ci Typecheck (affected) 2026-05-28T08:28:40.6220145Z
ci Typecheck (affected) 2026-05-28T08:28:40.6220162Z
ci Typecheck (affected) 2026-05-28T08:28:40.6222234Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m19bf31f3f8ef6143b3eaecc21085090af160f6c5[22m[39m
ci Typecheck (affected) 2026-05-28T08:28:40.6224154Z
ci Typecheck (affected) 2026-05-28T08:28:41.0188394Z
ci Typecheck (affected) 2026-05-28T08:28:41.0190007Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 11 projects and [1m9[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T08:28:41.0190873Z
ci Typecheck (affected) 2026-05-28T08:28:41.0191120Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T08:28:41.0191552Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T08:28:41.0191961Z [2m-[22m types
ci Typecheck (affected) 2026-05-28T08:28:41.0192420Z [2m-[22m adapter-codex
ci Typecheck (affected) 2026-05-28T08:28:41.0192911Z [2m-[22m engine
ci Typecheck (affected) 2026-05-28T08:28:41.0193331Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T08:28:41.0193762Z [2m-[22m cli-args
ci Typecheck (affected) 2026-05-28T08:28:41.0194223Z [2m-[22m context
ci Typecheck (affected) 2026-05-28T08:28:41.0194640Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T08:28:41.0195042Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T08:28:41.0195479Z [2m-[22m workflow
ci Typecheck (affected) 2026-05-28T08:28:41.0195730Z
ci Typecheck (affected) 2026-05-28T08:28:41.0195876Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T08:28:42.8135455Z
ci Typecheck (affected) 2026-05-28T08:28:42.8137060Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T08:28:42.8137880Z
ci Typecheck (affected) 2026-05-28T08:28:42.8138424Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T08:28:42.8138876Z
ci Typecheck (affected) 2026-05-28T08:28:43.9752826Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T08:28:43.9753672Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T08:28:43.9753988Z
ci Typecheck (affected) 2026-05-28T08:28:43.9754309Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T08:28:43.9754595Z
ci Typecheck (affected) 2026-05-28T08:28:45.1024767Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T08:28:45.1026132Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T08:28:45.1026638Z
ci Typecheck (affected) 2026-05-28T08:28:45.1027133Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T08:28:45.1027840Z
ci Typecheck (affected) 2026-05-28T08:28:46.2660439Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T0
…[truncated 400768 chars]

```

```
