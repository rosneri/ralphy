## Fix failing CI checks (2026-05-28T07:36:30.535Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26561285420 ---
ci Typecheck (affected) ﻿2026-05-28T07:34:56.8154283Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T07:34:56.8154573Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T07:34:56.8176507Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T07:34:56.8176736Z env:
ci Typecheck (affected) 2026-05-28T07:34:56.8176950Z NX_BASE: 7a34385610e4a4f399bb5cfb0fc433d33acdc388
ci Typecheck (affected) 2026-05-28T07:34:56.8177247Z NX_HEAD: 57168f3248f0bfb882408fd9c4169ac73fd2cbe7
ci Typecheck (affected) 2026-05-28T07:34:56.8177998Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T07:34:56.8178258Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:34:56.8232639Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T07:34:57.0160744Z
ci Typecheck (affected) 2026-05-28T07:34:57.0163443Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m7a34385610e4a4f399bb5cfb0fc433d33acdc388[22m[39m
ci Typecheck (affected) 2026-05-28T07:34:57.0164115Z
ci Typecheck (affected) 2026-05-28T07:34:57.0164121Z
ci Typecheck (affected) 2026-05-28T07:34:57.0164979Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m57168f3248f0bfb882408fd9c4169ac73fd2cbe7[22m[39m
ci Typecheck (affected) 2026-05-28T07:34:57.0165643Z
ci Typecheck (affected) 2026-05-28T07:34:57.3552007Z
ci Typecheck (affected) 2026-05-28T07:34:57.3553238Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 5 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T07:34:57.3553646Z
ci Typecheck (affected) 2026-05-28T07:34:57.3553759Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T07:34:57.3553979Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T07:34:57.3554202Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T07:34:57.3554401Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T07:34:57.3554619Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T07:34:57.3554725Z
ci Typecheck (affected) 2026-05-28T07:34:57.3554839Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T07:34:58.7104950Z
ci Typecheck (affected) 2026-05-28T07:34:58.7106195Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T07:34:58.7106493Z
ci Typecheck (affected) 2026-05-28T07:34:58.7106815Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:34:58.7107066Z
ci Typecheck (affected) 2026-05-28T07:34:59.5900228Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:34:59.5901027Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T07:34:59.5901315Z
ci Typecheck (affected) 2026-05-28T07:34:59.5901589Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:34:59.5901804Z
ci Typecheck (affected) 2026-05-28T07:35:00.4277482Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:35:00.4278413Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T07:35:00.4278674Z
ci Typecheck (affected) 2026-05-28T07:35:00.4278937Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:35:00.4279141Z
ci Typecheck (affected) 2026-05-28T07:35:01.3035281Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:35:01.3036245Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-28T07:35:01.3036605Z
ci Typecheck (affected) 2026-05-28T07:35:01.3036865Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:35:01.3037080Z
ci Typecheck (affected) 2026-05-28T07:35:02.3685790Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:35:02.3686808Z ##[group]✅ [2m> [22m[2mnx run[2
…[truncated 9280 chars]

```

```

## Fix failing CI checks (2026-05-28T07:32:59.778Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26561134123 ---
ci Typecheck (affected) ﻿2026-05-28T07:31:22.3488196Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T07:31:22.3488546Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T07:31:22.3514053Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T07:31:22.3514310Z env:
ci Typecheck (affected) 2026-05-28T07:31:22.3514537Z NX_BASE: 7a34385610e4a4f399bb5cfb0fc433d33acdc388
ci Typecheck (affected) 2026-05-28T07:31:22.3514876Z NX_HEAD: 8611f6abd4777440c6e053d56c4e07f906cd906a
ci Typecheck (affected) 2026-05-28T07:31:22.3515214Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T07:31:22.3515490Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:31:22.3580941Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T07:31:22.6197066Z
ci Typecheck (affected) 2026-05-28T07:31:22.6201962Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m7a34385610e4a4f399bb5cfb0fc433d33acdc388[22m[39m
ci Typecheck (affected) 2026-05-28T07:31:22.6203612Z
ci Typecheck (affected) 2026-05-28T07:31:22.6203625Z
ci Typecheck (affected) 2026-05-28T07:31:22.6204954Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m8611f6abd4777440c6e053d56c4e07f906cd906a[22m[39m
ci Typecheck (affected) 2026-05-28T07:31:22.6205774Z
ci Typecheck (affected) 2026-05-28T07:31:23.0242189Z
ci Typecheck (affected) 2026-05-28T07:31:23.0244033Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 5 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T07:31:23.0244891Z
ci Typecheck (affected) 2026-05-28T07:31:23.0245092Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T07:31:23.0245473Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T07:31:23.0245848Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T07:31:23.0246224Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T07:31:23.0246590Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T07:31:23.0246788Z
ci Typecheck (affected) 2026-05-28T07:31:23.0246994Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T07:31:24.9155858Z
ci Typecheck (affected) 2026-05-28T07:31:24.9157090Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T07:31:24.9157440Z
ci Typecheck (affected) 2026-05-28T07:31:24.9157775Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:31:24.9158044Z
ci Typecheck (affected) 2026-05-28T07:31:26.0960591Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:31:26.0961498Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T07:31:26.0961819Z
ci Typecheck (affected) 2026-05-28T07:31:26.0962149Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:31:26.0963062Z
ci Typecheck (affected) 2026-05-28T07:31:27.2278491Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:31:27.2279607Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T07:31:27.2280057Z
ci Typecheck (affected) 2026-05-28T07:31:27.2280562Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:31:27.2281049Z
ci Typecheck (affected) 2026-05-28T07:31:28.2957709Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:31:28.2958878Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-28T07:31:28.2959332Z
ci Typecheck (affected) 2026-05-28T07:31:28.2959800Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:31:28.2960206Z
ci Typecheck (affected) 2026-05-28T07:31:29.3181473Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:31:29.3183014Z ##[group]✅ [2m> [22m[2mnx run[2
…[truncated 14391 chars]

```

```

## Fix failing CI checks (2026-05-28T07:23:02.996Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26560755337 ---
ci Typecheck (affected) ﻿2026-05-28T07:22:20.7988014Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-28T07:22:20.7988352Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-28T07:22:20.8021482Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-28T07:22:20.8021740Z env:
ci Typecheck (affected) 2026-05-28T07:22:20.8021982Z NX_BASE: 7a34385610e4a4f399bb5cfb0fc433d33acdc388
ci Typecheck (affected) 2026-05-28T07:22:20.8022331Z NX_HEAD: 67ef4017c4d182a8dbb531e2f9ce8c7d5c3eb97c
ci Typecheck (affected) 2026-05-28T07:22:20.8022677Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-28T07:22:20.8022969Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:22:20.8094887Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-28T07:22:21.0686861Z
ci Typecheck (affected) 2026-05-28T07:22:21.0691632Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m7a34385610e4a4f399bb5cfb0fc433d33acdc388[22m[39m
ci Typecheck (affected) 2026-05-28T07:22:21.0693105Z
ci Typecheck (affected) 2026-05-28T07:22:21.0693116Z
ci Typecheck (affected) 2026-05-28T07:22:21.0694607Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m67ef4017c4d182a8dbb531e2f9ce8c7d5c3eb97c[22m[39m
ci Typecheck (affected) 2026-05-28T07:22:21.0695625Z
ci Typecheck (affected) 2026-05-28T07:22:21.4740946Z
ci Typecheck (affected) 2026-05-28T07:22:21.4742971Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 5 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-28T07:22:21.4743903Z
ci Typecheck (affected) 2026-05-28T07:22:21.4744193Z [2m-[22m core
ci Typecheck (affected) 2026-05-28T07:22:21.4744646Z [2m-[22m agent
ci Typecheck (affected) 2026-05-28T07:22:21.4745072Z [2m-[22m shell
ci Typecheck (affected) 2026-05-28T07:22:21.4745493Z [2m-[22m loop
ci Typecheck (affected) 2026-05-28T07:22:21.4745946Z [2m-[22m mcp
ci Typecheck (affected) 2026-05-28T07:22:21.4746167Z
ci Typecheck (affected) 2026-05-28T07:22:21.4746769Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-28T07:22:23.3262585Z
ci Typecheck (affected) 2026-05-28T07:22:23.3263667Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-28T07:22:23.3263945Z
ci Typecheck (affected) 2026-05-28T07:22:23.3264234Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:22:23.3264471Z
ci Typecheck (affected) 2026-05-28T07:22:24.5234563Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:22:24.5235536Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-28T07:22:24.5236052Z
ci Typecheck (affected) 2026-05-28T07:22:24.5236765Z [2m> [22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:22:24.5237158Z
ci Typecheck (affected) 2026-05-28T07:22:25.6392625Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:22:25.6393468Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-28T07:22:25.6393785Z
ci Typecheck (affected) 2026-05-28T07:22:25.6394105Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:22:25.6394390Z
ci Typecheck (affected) 2026-05-28T07:22:26.6991824Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:22:26.6992756Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-28T07:22:26.6993044Z
ci Typecheck (affected) 2026-05-28T07:22:26.6993468Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-28T07:22:26.6993793Z
ci Typecheck (affected) 2026-05-28T07:22:27.7409374Z ##[endgroup]
ci Typecheck (affected) 2026-05-28T07:22:27.7410538Z ##[group]✅ [2m> [22m[2mnx run[2
…[truncated 16820 chars]

```

```
