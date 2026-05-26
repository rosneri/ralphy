## Fix failing CI checks (2026-05-26T22:39:57.943Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26479159031 ---
ci Typecheck (affected) ﻿2026-05-26T22:38:08.3865485Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-26T22:38:08.3865820Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-26T22:38:08.3899046Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-26T22:38:08.3899300Z env:
ci Typecheck (affected) 2026-05-26T22:38:08.3899528Z NX_BASE: 2f73550977cc380d16fbb753495049ecfb4ef2f3
ci Typecheck (affected) 2026-05-26T22:38:08.3899870Z NX_HEAD: ddc2efea301076cb40f4c5f129c67cf708a5cb28
ci Typecheck (affected) 2026-05-26T22:38:08.3900217Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-26T22:38:08.3900491Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T22:38:08.3969978Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-26T22:38:08.6576893Z
ci Typecheck (affected) 2026-05-26T22:38:08.6582128Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m2f73550977cc380d16fbb753495049ecfb4ef2f3[22m[39m
ci Typecheck (affected) 2026-05-26T22:38:08.6583655Z
ci Typecheck (affected) 2026-05-26T22:38:08.6583671Z
ci Typecheck (affected) 2026-05-26T22:38:08.6585772Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1mddc2efea301076cb40f4c5f129c67cf708a5cb28[22m[39m
ci Typecheck (affected) 2026-05-26T22:38:08.6587290Z
ci Typecheck (affected) 2026-05-26T22:38:09.0576716Z
ci Typecheck (affected) 2026-05-26T22:38:09.0578717Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 2 projects and [1m17[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-26T22:38:09.0579590Z
ci Typecheck (affected) 2026-05-26T22:38:09.0579792Z [2m-[22m agent
ci Typecheck (affected) 2026-05-26T22:38:09.0580190Z [2m-[22m shell
ci Typecheck (affected) 2026-05-26T22:38:09.0580405Z
ci Typecheck (affected) 2026-05-26T22:38:09.0580625Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-26T22:38:10.9114700Z
ci Typecheck (affected) 2026-05-26T22:38:10.9116066Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-26T22:38:10.9116426Z
ci Typecheck (affected) 2026-05-26T22:38:10.9116783Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-26T22:38:10.9117075Z
ci Typecheck (affected) 2026-05-26T22:38:11.9759218Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T22:38:11.9760284Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-26T22:38:11.9760567Z
ci Typecheck (affected) 2026-05-26T22:38:11.9760877Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-26T22:38:11.9761152Z
ci Typecheck (affected) 2026-05-26T22:38:13.1319323Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T22:38:13.1320483Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-26T22:38:13.1320953Z
ci Typecheck (affected) 2026-05-26T22:38:13.1321445Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-26T22:38:13.1321874Z
ci Typecheck (affected) 2026-05-26T22:38:14.2449044Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T22:38:14.2449812Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-26T22:38:14.2450075Z
ci Typecheck (affected) 2026-05-26T22:38:14.2450368Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-26T22:38:14.2450947Z
ci Typecheck (affected) 2026-05-26T22:38:15.3553003Z ##[endgroup]
ci Typecheck (affected) 2026-05-26T22:38:15.3554158Z ##[group]✅ [2m> [22m[2mnx run[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-26T22:38:15.3554637Z
ci Typecheck (affected) 2026-05-26T22:38:15.3555207Z [2m> [22mtsc -b packages/telemetry/tsconfig.json
ci Typecheck (affected) 2
…[truncated 9243 chars]

```

```
