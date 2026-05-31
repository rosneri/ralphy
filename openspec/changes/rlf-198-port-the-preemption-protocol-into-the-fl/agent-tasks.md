## Fix failing CI checks (2026-05-31T16:23:09.974Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717903525 ---
ci Unused dependency check ﻿2026-05-31T16:21:59.0900408Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-31T16:21:59.0900980Z ^[[36;1mbun run check:unused:ci^[[0m
ci Unused dependency check 2026-05-31T16:21:59.0934068Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-31T16:21:59.0934373Z env:
ci Unused dependency check 2026-05-31T16:21:59.0934646Z NX_BASE: 40bda67b40086084dc16fb9e91732a0a6cedd622
ci Unused dependency check 2026-05-31T16:21:59.0935027Z NX_HEAD: 50786ea5b48627d96aa1de0d4746d43022f7267d
ci Unused dependency check 2026-05-31T16:21:59.0935338Z ##[endgroup]
ci Unused dependency check 2026-05-31T16:21:59.1014009Z $ knip
ci Unused dependency check 2026-05-31T16:22:03.6821235Z ^[[93m^[[4mUnused devDependencies^[[24m^[[39m (1)
ci Unused dependency check 2026-05-31T16:22:03.6829112Z @rosneri/xstate-mcp package.json:74:6
ci Unused dependency check 2026-05-31T16:22:03.7125700Z error: script "check:unused:ci" exited with code 1
ci Unused dependency check 2026-05-31T16:22:03.7136419Z ##[error]Process completed with exit code 1.

```

```

## Fix failing CI checks (2026-05-31T16:19:43.127Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717844658 ---
ci Run ./.github/actions/setup ﻿2026-05-31T16:18:37.1037254Z Prepare all required actions
ci Run ./.github/actions/setup 2026-05-31T16:18:37.1038700Z Getting action download info
ci Run ./.github/actions/setup 2026-05-31T16:18:37.3380569Z Download action repository 'actions/setup-node@v6' (SHA:48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e)
ci Run ./.github/actions/setup 2026-05-31T16:18:37.4288819Z Download action repository 'oven-sh/setup-bun@v2' (SHA:0c5077e51419868618aeaa5fe8019c62421857d6)
ci Run ./.github/actions/setup 2026-05-31T16:18:37.5486740Z Download action repository 'actions/cache@v5' (SHA:27d5ce7f107fe9357f9df03efb73ab90386fccae)
ci Run ./.github/actions/setup 2026-05-31T16:18:37.6557805Z Download action repository 'nrwl/nx-set-shas@v5' (SHA:afb73a62d26e41464e9254689e1fd6122ee683c1)
ci Run ./.github/actions/setup 2026-05-31T16:18:37.7918516Z ##[group]Run ./.github/actions/setup
ci Run ./.github/actions/setup 2026-05-31T16:18:37.7918867Z with:
ci Run ./.github/actions/setup 2026-05-31T16:18:37.7919089Z nx-shas: true
ci Run ./.github/actions/setup 2026-05-31T16:18:37.7919315Z ##[endgroup]
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8064339Z ##[group]Run actions/setup-node@v6
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8064680Z with:
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8064891Z node-version: 22
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8065134Z check-latest: false
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8068188Z token: **_
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8068484Z package-manager-cache: true
ci Run ./.github/actions/setup 2026-05-31T16:18:37.8068763Z ##[endgroup]
ci Run ./.github/actions/setup 2026-05-31T16:18:37.9770533Z Found in cache @ /opt/hostedtoolcache/node/22.22.3/x64
ci Run ./.github/actions/setup 2026-05-31T16:18:37.9771612Z ##[group]Environment details
ci Run ./.github/actions/setup 2026-05-31T16:18:38.3839515Z node: v22.22.3
ci Run ./.github/actions/setup 2026-05-31T16:18:38.3840580Z npm: 10.9.8
ci Run ./.github/actions/setup 2026-05-31T16:18:38.3841082Z yarn: 1.22.22
ci Run ./.github/actions/setup 2026-05-31T16:18:38.3842164Z ##[endgroup]
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4053875Z ##[group]Run oven-sh/setup-bun@v2
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4054201Z with:
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4054423Z bun-version: 1.3.14
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4054667Z no-cache: false
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4057776Z token: _**
ci Run ./.github/actions/setup 2026-05-31T16:18:38.4057997Z ##[endgroup]
ci Run ./.github/actions/setup 2026-05-31T16:18:38.6359911Z Cache hit for: bun-fR4r1tsFeXfPQkusQwkKD2kGnsE=
ci Run ./.github/actions/setup 2026-05-31T16:18:38.9124574Z Received 33843769 of 33843769 (100.0%), 141.6 MBs/sec
ci Run ./.github/actions/setup 2026-05-31T16:18:38.9125938Z Cache Size: ~32 MB (33843769 B)
ci Run ./.github/actions/setup 2026-05-31T16:18:38.9159718Z [command]/usr/bin/tar -xf /home/runner/work/\_temp/76c35c9d-0b39-4a4d-b21d-2a2946c6376c/cache.tzst -P -C /home/runner/work/ralphy/ralphy --use-compress-program unzstd
ci Run ./.github/actions/setup 2026-05-31T16:18:39.0842739Z Cache restored successfully
ci Run ./.github/actions/setup 2026-05-31T16:18:39.0867677Z [command]/home/runner/.bun/bin/bun --revision
ci Run ./.github/actions/setup 2026-05-31T16:18:39.0920214Z 1.3.14+0d9b296af
ci Run ./.github/actions/setup 2026-05-31T16:18:39.0927199Z Using a cached version of Bun: 1.3.14+0d9b296af
ci Run ./.github/actions/setup 2026-05-31T16:18:39.1751651Z ##[group]Run actions/cache@v5
ci Run ./.github/actions/setup 2026-05-31T16:18:39.1751957Z with:
ci Run ./.github/actions/setup 2026-05-31T16:18:39.1752175Z path: ~/.bun/install/cache
ci Run ./.github/actions/setup 2026-05-31T16:18:39.1752631Z key: bun-store-Linux-7d7b0b966892e9e9848d9a4db7c46037a6f56eef347ccc98fcb864674c43d2e8
ci Run ./.github/actions/setup 2026-05-31T16:18:39.
…[truncated 3337 chars]

```

```

## Fix failing CI checks (2026-05-31T16:14:15.704Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717719809 ---
ci Unused dependency check ﻿2026-05-31T16:14:04.3519923Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-31T16:14:04.3520305Z ^[[36;1mbun run check:unused:ci^[[0m
ci Unused dependency check 2026-05-31T16:14:04.3549596Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-31T16:14:04.3549935Z env:
ci Unused dependency check 2026-05-31T16:14:04.3550206Z NX_BASE: 40bda67b40086084dc16fb9e91732a0a6cedd622
ci Unused dependency check 2026-05-31T16:14:04.3550598Z NX_HEAD: 3143587367bf4bb30b4d2019b262a83a0ee8870d
ci Unused dependency check 2026-05-31T16:14:04.3550918Z ##[endgroup]
ci Unused dependency check 2026-05-31T16:14:04.3626457Z $ knip
ci Unused dependency check 2026-05-31T16:14:08.9067335Z ^[[93m^[[4mUnused devDependencies^[[24m^[[39m (1)
ci Unused dependency check 2026-05-31T16:14:08.9075797Z @rosneri/xstate-mcp package.json:74:6
ci Unused dependency check 2026-05-31T16:14:08.9076550Z ^[[93m^[[4mUnused exports^[[24m^[[39m (1)
ci Unused dependency check 2026-05-31T16:14:08.9077302Z preemptionActorLogic apps/agent/src/runtime/flow-runner.ts:7:10
ci Unused dependency check 2026-05-31T16:14:08.9078039Z ^[[93m^[[4mUnused exported types^[[24m^[[39m (1)
ci Unused dependency check 2026-05-31T16:14:08.9078541Z Teardown type apps/agent/src/runtime/flow-runner.ts:8:27
ci Unused dependency check 2026-05-31T16:14:08.9084502Z ^[[33m^[[4mConfiguration hints^[[24m (1)^[[39m
ci Unused dependency check 2026-05-31T16:14:08.9088216Z apps/agent/src/runtime/machines/inspector.ts knip.json ^[[90mRemove from ^[[97mignore^[[90m^[[39m
ci Unused dependency check 2026-05-31T16:14:08.9427582Z error: script "check:unused:ci" exited with code 1
ci Unused dependency check 2026-05-31T16:14:08.9439032Z ##[error]Process completed with exit code 1.

```

```

## Fix failing CI checks (2026-05-31T16:07:59.899Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717576266 ---
ci Typecheck (affected) ﻿2026-05-31T16:07:20.6090802Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-31T16:07:20.6091158Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-31T16:07:20.6117128Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-31T16:07:20.6117407Z env:
ci Typecheck (affected) 2026-05-31T16:07:20.6117654Z NX_BASE: 9d024479f9a08c3291222e44f2f3d9e1e84a3582
ci Typecheck (affected) 2026-05-31T16:07:20.6118015Z NX_HEAD: 58ec415ed915e5d231a785dbb748b73e199cf104
ci Typecheck (affected) 2026-05-31T16:07:20.6118401Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-31T16:07:20.6118704Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T16:07:20.6188321Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-31T16:07:20.8822820Z
ci Typecheck (affected) 2026-05-31T16:07:20.8827285Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m9d024479f9a08c3291222e44f2f3d9e1e84a3582^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T16:07:20.8828269Z
ci Typecheck (affected) 2026-05-31T16:07:20.8828278Z
ci Typecheck (affected) 2026-05-31T16:07:20.8829515Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m58ec415ed915e5d231a785dbb748b73e199cf104^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T16:07:20.8830484Z
ci Typecheck (affected) 2026-05-31T16:07:21.3015730Z
ci Typecheck (affected) 2026-05-31T16:07:21.3017590Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 21 projects:^[[39m
ci Typecheck (affected) 2026-05-31T16:07:21.3018338Z
ci Typecheck (affected) 2026-05-31T16:07:21.3018673Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-31T16:07:21.3019140Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-31T16:07:21.3019605Z ^[[2m-^[[22m core
ci Typecheck (affected) 2026-05-31T16:07:21.3020052Z ^[[2m-^[[22m loop
ci Typecheck (affected) 2026-05-31T16:07:21.3020495Z ^[[2m-^[[22m mcp
ci Typecheck (affected) 2026-05-31T16:07:21.3021006Z ^[[2m-^[[22m agent-protocol
ci Typecheck (affected) 2026-05-31T16:07:21.3021576Z ^[[2m-^[[22m adapter-codex
ci Typecheck (affected) 2026-05-31T16:07:21.3022127Z ^[[2m-^[[22m engine
ci Typecheck (affected) 2026-05-31T16:07:21.3022636Z ^[[2m-^[[22m change-store
ci Typecheck (affected) 2026-05-31T16:07:21.3023197Z ^[[2m-^[[22m openspec
ci Typecheck (affected) 2026-05-31T16:07:21.3023699Z ^[[2m-^[[22m telemetry
ci Typecheck (affected) 2026-05-31T16:07:21.3024154Z ^[[2m-^[[22m events
ci Typecheck (affected) 2026-05-31T16:07:21.3024899Z ^[[2m-^[[22m cli-args
ci Typecheck (affected) 2026-05-31T16:07:21.3025355Z ^[[2m-^[[22m context
ci Typecheck (affected) 2026-05-31T16:07:21.3025822Z ^[[2m-^[[22m workflow
ci Typecheck (affected) 2026-05-31T16:07:21.3026269Z ^[[2m-^[[22m content
ci Typecheck (affected) 2026-05-31T16:07:21.3026693Z ^[[2m-^[[22m version
ci Typecheck (affected) 2026-05-31T16:07:21.3027141Z ^[[2m-^[[22m output
ci Typecheck (affected) 2026-05-31T16:07:21.3027570Z ^[[2m-^[[22m paths
ci Typecheck (affected) 2026-05-31T16:07:21.3028026Z ^[[2m-^[[22m types
ci Typecheck (affected) 2026-05-31T16:07:21.3028488Z ^[[2m-^[[22m log
ci Typecheck (affected) 2026-05-31T16:07:21.3028732Z
ci Typecheck (affected) 2026-05-31T16:07:21.3028996Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-31T16:07:23.4061015Z
ci Typecheck (affected) 2026-05-31T16:07:23.4062464Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-31T16:07:23.4062932Z
ci Typecheck (affected) 2026-05-31T16:07:23.4063427Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-31T16:07:23.4063840Z
ci Typecheck (affected) 2026-05-31T16:07:24.6472505Z ##[endgroup]
ci Typecheck (affected) 2026-
…[truncated 25763 chars]

```

```

## Fix failing CI checks (2026-05-31T16:04:55.943Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717503298 ---
ci Format check (affected) ﻿2026-05-31T16:04:03.3193643Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-31T16:04:03.3193986Z ^[[36;1mbun run fmt:ci^[[0m
ci Format check (affected) 2026-05-31T16:04:03.3221648Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-31T16:04:03.3221943Z env:
ci Format check (affected) 2026-05-31T16:04:03.3222224Z NX_BASE: 9d024479f9a08c3291222e44f2f3d9e1e84a3582
ci Format check (affected) 2026-05-31T16:04:03.3222607Z NX_HEAD: 3f82fb0443c71f9be2d813341f674994f06d8a26
ci Format check (affected) 2026-05-31T16:04:03.3222941Z ##[endgroup]
ci Format check (affected) 2026-05-31T16:04:03.3291760Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-31T16:04:03.5559104Z
ci Format check (affected) 2026-05-31T16:04:03.5563445Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m9d024479f9a08c3291222e44f2f3d9e1e84a3582^[[22m^[[39m
ci Format check (affected) 2026-05-31T16:04:03.5564799Z
ci Format check (affected) 2026-05-31T16:04:03.5564814Z
ci Format check (affected) 2026-05-31T16:04:03.5566672Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m3f82fb0443c71f9be2d813341f674994f06d8a26^[[22m^[[39m
ci Format check (affected) 2026-05-31T16:04:03.5567987Z
ci Format check (affected) 2026-05-31T16:04:03.9225324Z
ci Format check (affected) 2026-05-31T16:04:03.9226871Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mfmt:check^[[22m for 21 projects:^[[39m
ci Format check (affected) 2026-05-31T16:04:03.9227367Z
ci Format check (affected) 2026-05-31T16:04:03.9227593Z ^[[2m-^[[22m agent
ci Format check (affected) 2026-05-31T16:04:03.9227965Z ^[[2m-^[[22m shell
ci Format check (affected) 2026-05-31T16:04:03.9228537Z ^[[2m-^[[22m core
ci Format check (affected) 2026-05-31T16:04:03.9228798Z ^[[2m-^[[22m loop
ci Format check (affected) 2026-05-31T16:04:03.9229043Z ^[[2m-^[[22m mcp
ci Format check (affected) 2026-05-31T16:04:03.9229337Z ^[[2m-^[[22m agent-protocol
ci Format check (affected) 2026-05-31T16:04:03.9229669Z ^[[2m-^[[22m adapter-codex
ci Format check (affected) 2026-05-31T16:04:03.9229977Z ^[[2m-^[[22m engine
ci Format check (affected) 2026-05-31T16:04:03.9230265Z ^[[2m-^[[22m change-store
ci Format check (affected) 2026-05-31T16:04:03.9230566Z ^[[2m-^[[22m openspec
ci Format check (affected) 2026-05-31T16:04:03.9231088Z ^[[2m-^[[22m telemetry
ci Format check (affected) 2026-05-31T16:04:03.9231444Z ^[[2m-^[[22m events
ci Format check (affected) 2026-05-31T16:04:03.9231729Z ^[[2m-^[[22m cli-args
ci Format check (affected) 2026-05-31T16:04:03.9232013Z ^[[2m-^[[22m context
ci Format check (affected) 2026-05-31T16:04:03.9232287Z ^[[2m-^[[22m workflow
ci Format check (affected) 2026-05-31T16:04:03.9232555Z ^[[2m-^[[22m content
ci Format check (affected) 2026-05-31T16:04:03.9232839Z ^[[2m-^[[22m version
ci Format check (affected) 2026-05-31T16:04:03.9233103Z ^[[2m-^[[22m output
ci Format check (affected) 2026-05-31T16:04:03.9233361Z ^[[2m-^[[22m paths
ci Format check (affected) 2026-05-31T16:04:03.9233625Z ^[[2m-^[[22m types
ci Format check (affected) 2026-05-31T16:04:03.9233879Z ^[[2m-^[[22m log
ci Format check (affected) 2026-05-31T16:04:03.9234017Z
ci Format check (affected) 2026-05-31T16:04:03.9234154Z ^[[2m^[[36m^[[39m^[[22m
ci Format check (affected) 2026-05-31T16:04:04.1250009Z
ci Format check (affected) 2026-05-31T16:04:04.1251713Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:"fmt:check"
ci Format check (affected) 2026-05-31T16:04:04.1252174Z
ci Format check (affected) 2026-05-31T16:04:04.1252637Z ^[[2m> ^[[22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-31T16:04:04.1253018Z
ci Format check (affected) 2026-05-31T16:04:04.1253229Z Checking formatting...
ci
…[truncated 17477 chars]

```

```

## Fix failing CI checks (2026-05-31T15:59:39.071Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26717374273 ---
ci Format check (affected) ﻿2026-05-31T15:58:43.8610174Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-31T15:58:43.8610499Z ^[[36;1mbun run fmt:ci^[[0m
ci Format check (affected) 2026-05-31T15:58:43.8638341Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-31T15:58:43.8638622Z env:
ci Format check (affected) 2026-05-31T15:58:43.8638886Z NX_BASE: f0086928abadeb63913b4703707b32e6aa205702
ci Format check (affected) 2026-05-31T15:58:43.8639245Z NX_HEAD: 3815e72d5cd490c58ba1c7b403566a4d84d6eccd
ci Format check (affected) 2026-05-31T15:58:43.8639550Z ##[endgroup]
ci Format check (affected) 2026-05-31T15:58:43.8709870Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-31T15:58:44.1296778Z
ci Format check (affected) 2026-05-31T15:58:44.1301755Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1mf0086928abadeb63913b4703707b32e6aa205702^[[22m^[[39m
ci Format check (affected) 2026-05-31T15:58:44.1303160Z
ci Format check (affected) 2026-05-31T15:58:44.1303186Z
ci Format check (affected) 2026-05-31T15:58:44.1305140Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m3815e72d5cd490c58ba1c7b403566a4d84d6eccd^[[22m^[[39m
ci Format check (affected) 2026-05-31T15:58:44.1306546Z
ci Format check (affected) 2026-05-31T15:58:44.6959708Z
ci Format check (affected) 2026-05-31T15:58:44.6961737Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mfmt:check^[[22m for 21 projects:^[[39m
ci Format check (affected) 2026-05-31T15:58:44.6962155Z
ci Format check (affected) 2026-05-31T15:58:44.6962386Z ^[[2m-^[[22m agent
ci Format check (affected) 2026-05-31T15:58:44.6962711Z ^[[2m-^[[22m shell
ci Format check (affected) 2026-05-31T15:58:44.6962959Z ^[[2m-^[[22m core
ci Format check (affected) 2026-05-31T15:58:44.6963204Z ^[[2m-^[[22m loop
ci Format check (affected) 2026-05-31T15:58:44.6963437Z ^[[2m-^[[22m mcp
ci Format check (affected) 2026-05-31T15:58:44.6963735Z ^[[2m-^[[22m agent-protocol
ci Format check (affected) 2026-05-31T15:58:44.6964047Z ^[[2m-^[[22m adapter-codex
ci Format check (affected) 2026-05-31T15:58:44.6964337Z ^[[2m-^[[22m engine
ci Format check (affected) 2026-05-31T15:58:44.6964605Z ^[[2m-^[[22m change-store
ci Format check (affected) 2026-05-31T15:58:44.6964887Z ^[[2m-^[[22m openspec
ci Format check (affected) 2026-05-31T15:58:44.6965155Z ^[[2m-^[[22m telemetry
ci Format check (affected) 2026-05-31T15:58:44.6965431Z ^[[2m-^[[22m events
ci Format check (affected) 2026-05-31T15:58:44.6965691Z ^[[2m-^[[22m cli-args
ci Format check (affected) 2026-05-31T15:58:44.6965945Z ^[[2m-^[[22m context
ci Format check (affected) 2026-05-31T15:58:44.6966206Z ^[[2m-^[[22m workflow
ci Format check (affected) 2026-05-31T15:58:44.6966456Z ^[[2m-^[[22m content
ci Format check (affected) 2026-05-31T15:58:44.6966721Z ^[[2m-^[[22m version
ci Format check (affected) 2026-05-31T15:58:44.6966967Z ^[[2m-^[[22m output
ci Format check (affected) 2026-05-31T15:58:44.6967226Z ^[[2m-^[[22m paths
ci Format check (affected) 2026-05-31T15:58:44.6967472Z ^[[2m-^[[22m types
ci Format check (affected) 2026-05-31T15:58:44.6967716Z ^[[2m-^[[22m log
ci Format check (affected) 2026-05-31T15:58:44.6967846Z
ci Format check (affected) 2026-05-31T15:58:44.6967983Z ^[[2m^[[36m^[[39m^[[22m
ci Format check (affected) 2026-05-31T15:58:44.8619422Z
ci Format check (affected) 2026-05-31T15:58:44.8620984Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:"fmt:check"
ci Format check (affected) 2026-05-31T15:58:44.8621281Z
ci Format check (affected) 2026-05-31T15:58:44.8621581Z ^[[2m> ^[[22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-31T15:58:44.8621815Z
ci Format check (affected) 2026-05-31T15:58:44.8621957Z Checking formatting...
ci
…[truncated 17477 chars]

```

```
