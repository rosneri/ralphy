## Fix failing CI checks (2026-05-25T19:37:52.496Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26416772588 ---
ci Typecheck (affected) ﻿2026-05-25T19:36:01.8993534Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-25T19:36:01.8993847Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-25T19:36:01.9013601Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-25T19:36:01.9013860Z env:
ci Typecheck (affected) 2026-05-25T19:36:01.9014085Z NX_BASE: ab6e0624036fca26c564c66eec74d171c8ba5d2d
ci Typecheck (affected) 2026-05-25T19:36:01.9014399Z NX_HEAD: 44df8186b05155a2612373c2acfd61378e89b82f
ci Typecheck (affected) 2026-05-25T19:36:01.9014852Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-25T19:36:01.9015115Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T19:36:01.9067338Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-25T19:36:02.1237202Z
ci Typecheck (affected) 2026-05-25T19:36:02.1241392Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mab6e0624036fca26c564c66eec74d171c8ba5d2d[22m[39m
ci Typecheck (affected) 2026-05-25T19:36:02.1242718Z
ci Typecheck (affected) 2026-05-25T19:36:02.1242742Z
ci Typecheck (affected) 2026-05-25T19:36:02.1244564Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m44df8186b05155a2612373c2acfd61378e89b82f[22m[39m
ci Typecheck (affected) 2026-05-25T19:36:02.1245849Z
ci Typecheck (affected) 2026-05-25T19:36:02.4737842Z
ci Typecheck (affected) 2026-05-25T19:36:02.4739390Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 2 projects and [1m17[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-25T19:36:02.4739864Z
ci Typecheck (affected) 2026-05-25T19:36:02.4739999Z [2m-[22m agent
ci Typecheck (affected) 2026-05-25T19:36:02.4740235Z [2m-[22m shell
ci Typecheck (affected) 2026-05-25T19:36:02.4740355Z
ci Typecheck (affected) 2026-05-25T19:36:02.4740467Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-25T19:36:04.3248941Z
ci Typecheck (affected) 2026-05-25T19:36:04.3250290Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-25T19:36:04.3250722Z
ci Typecheck (affected) 2026-05-25T19:36:04.3251186Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-25T19:36:04.3251526Z
ci Typecheck (affected) 2026-05-25T19:36:05.4113001Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T19:36:05.4114040Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-25T19:36:05.4114467Z
ci Typecheck (affected) 2026-05-25T19:36:05.4114942Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-25T19:36:05.4115228Z
ci Typecheck (affected) 2026-05-25T19:36:06.6154646Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T19:36:06.6155665Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-25T19:36:06.6156056Z
ci Typecheck (affected) 2026-05-25T19:36:06.6156529Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-25T19:36:06.6156879Z
ci Typecheck (affected) 2026-05-25T19:36:07.7725777Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T19:36:07.7726798Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-25T19:36:07.7727193Z
ci Typecheck (affected) 2026-05-25T19:36:07.7727611Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-25T19:36:07.7727964Z
ci Typecheck (affected) 2026-05-25T19:36:08.8764207Z ##[endgroup]
ci Typecheck (affected) 2026-05-25T19:36:08.8765243Z ##[group]✅ [2m> [22m[2mnx run[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-25T19:36:08.8765638Z
ci Typecheck (affected) 2026-05-25T19:36:08.8766116Z [2m> [22mtsc -b packages/telemetry/tsconfig.json
ci Typecheck (affected) 2
…[truncated 315025 chars]

```

```
