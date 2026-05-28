## Fix failing CI checks (2026-05-28T06:17:09.899Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26558197873 ---
ci Typecheck (affected) ﻿2026-05-28T06:16:21.2340935Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T06:16:21.2341244Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T06:16:21.2356985Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T06:16:21.2357262Z env:
ci Typecheck (affected) 2026-05-28T06:16:21.2357504Z NX_BASE: ad6af0233eccc19c091b637be00ff61767553d52
ci Typecheck (affected) 2026-05-28T06:16:21.2357830Z NX_HEAD: e2a6f2dd3856e5f2392b0df3ddebb213998da352
ci Typecheck (affected) 2026-05-28T06:16:21.2358162Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T06:16:21.2358426Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:21.2540793Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T06:16:21.4867705Z
ci Typecheck (affected) 2026-05-28T06:16:21.4872546Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mad6af0233eccc19c091b637be00ff61767553d52[22m[39m
ci Typecheck (affected) 2026-05-28T06:16:21.4873940Z
ci Typecheck (affected) 2026-05-28T06:16:21.4873956Z
ci Typecheck (affected) 2026-05-28T06:16:21.4875737Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1me2a6f2dd3856e5f2392b0df3ddebb213998da352[22m[39m
ci Typecheck (affected) 2026-05-28T06:16:21.4877036Z
ci Typecheck (affected) 2026-05-28T06:16:21.9085447Z
ci Typecheck (affected) 2026-05-28T06:16:21.9087270Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 6 projects and [1m14[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T06:16:21.9088046Z
ci Typecheck (affected) 2026-05-28T06:16:21.9088270Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T06:16:21.9088610Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T06:16:21.9088914Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T06:16:21.9089218Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T06:16:21.9089530Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T06:16:21.9089898Z [2m-[22m workflow
ci Typecheck (affected) 2026-05-28T06:16:21.9090098Z
ci Typecheck (affected) 2026-05-28T06:16:21.9090322Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T06:16:23.6469596Z
ci Typecheck (affected) 2026-05-28T06:16:23.6471309Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T06:16:23.6471935Z
ci Typecheck (affected) 2026-05-28T06:16:23.6472369Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:23.6472726Z
ci Typecheck (affected) 2026-05-28T06:16:24.6583268Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:24.6584354Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T06:16:24.6584725Z
ci Typecheck (affected) 2026-05-28T06:16:24.6585132Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:24.6585492Z
ci Typecheck (affected) 2026-05-28T06:16:25.7124994Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:25.7125700Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T06:16:25.7125960Z
ci Typecheck (affected) 2026-05-28T06:16:25.7126231Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:26.6813925Z
ci Typecheck (affected) 2026-05-28T06:16:26.6814821Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T06:16:26.6815791Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-28T06:16:26.6816165Z
ci Typecheck (affected) 2026-05-28T06:16:26.6816589Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-28T06:16:26.6816916Z
ci Typecheck (affected) 2026-05-28T06:16:27.5907389Z ##[endgroup]
ci Typecheck (a
…[truncated 8691 chars]

```

```
