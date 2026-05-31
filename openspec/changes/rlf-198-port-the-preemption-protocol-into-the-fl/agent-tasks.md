## Fix failing CI checks (2026-05-31T16:04:55.943Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```
--- run 26717503298 ---
ci	Format check (affected)	﻿2026-05-31T16:04:03.3193643Z ##[group]Run bun run fmt:ci
ci	Format check (affected)	2026-05-31T16:04:03.3193986Z ^[[36;1mbun run fmt:ci^[[0m
ci	Format check (affected)	2026-05-31T16:04:03.3221648Z shell: /usr/bin/bash -e {0}
ci	Format check (affected)	2026-05-31T16:04:03.3221943Z env:
ci	Format check (affected)	2026-05-31T16:04:03.3222224Z   NX_BASE: 9d024479f9a08c3291222e44f2f3d9e1e84a3582
ci	Format check (affected)	2026-05-31T16:04:03.3222607Z   NX_HEAD: 3f82fb0443c71f9be2d813341f674994f06d8a26
ci	Format check (affected)	2026-05-31T16:04:03.3222941Z ##[endgroup]
ci	Format check (affected)	2026-05-31T16:04:03.3291760Z $ nx affected -t fmt:check --exclude=ui
ci	Format check (affected)	2026-05-31T16:04:03.5559104Z 
ci	Format check (affected)	2026-05-31T16:04:03.5563445Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m9d024479f9a08c3291222e44f2f3d9e1e84a3582^[[22m^[[39m
ci	Format check (affected)	2026-05-31T16:04:03.5564799Z 
ci	Format check (affected)	2026-05-31T16:04:03.5564814Z 
ci	Format check (affected)	2026-05-31T16:04:03.5566672Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m3f82fb0443c71f9be2d813341f674994f06d8a26^[[22m^[[39m
ci	Format check (affected)	2026-05-31T16:04:03.5567987Z 
ci	Format check (affected)	2026-05-31T16:04:03.9225324Z 
ci	Format check (affected)	2026-05-31T16:04:03.9226871Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m  ^[[36mRunning target ^[[1mfmt:check^[[22m for 21 projects:^[[39m
ci	Format check (affected)	2026-05-31T16:04:03.9227367Z 
ci	Format check (affected)	2026-05-31T16:04:03.9227593Z ^[[2m-^[[22m agent
ci	Format check (affected)	2026-05-31T16:04:03.9227965Z ^[[2m-^[[22m shell
ci	Format check (affected)	2026-05-31T16:04:03.9228537Z ^[[2m-^[[22m core
ci	Format check (affected)	2026-05-31T16:04:03.9228798Z ^[[2m-^[[22m loop
ci	Format check (affected)	2026-05-31T16:04:03.9229043Z ^[[2m-^[[22m mcp
ci	Format check (affected)	2026-05-31T16:04:03.9229337Z ^[[2m-^[[22m agent-protocol
ci	Format check (affected)	2026-05-31T16:04:03.9229669Z ^[[2m-^[[22m adapter-codex
ci	Format check (affected)	2026-05-31T16:04:03.9229977Z ^[[2m-^[[22m engine
ci	Format check (affected)	2026-05-31T16:04:03.9230265Z ^[[2m-^[[22m change-store
ci	Format check (affected)	2026-05-31T16:04:03.9230566Z ^[[2m-^[[22m openspec
ci	Format check (affected)	2026-05-31T16:04:03.9231088Z ^[[2m-^[[22m telemetry
ci	Format check (affected)	2026-05-31T16:04:03.9231444Z ^[[2m-^[[22m events
ci	Format check (affected)	2026-05-31T16:04:03.9231729Z ^[[2m-^[[22m cli-args
ci	Format check (affected)	2026-05-31T16:04:03.9232013Z ^[[2m-^[[22m context
ci	Format check (affected)	2026-05-31T16:04:03.9232287Z ^[[2m-^[[22m workflow
ci	Format check (affected)	2026-05-31T16:04:03.9232555Z ^[[2m-^[[22m content
ci	Format check (affected)	2026-05-31T16:04:03.9232839Z ^[[2m-^[[22m version
ci	Format check (affected)	2026-05-31T16:04:03.9233103Z ^[[2m-^[[22m output
ci	Format check (affected)	2026-05-31T16:04:03.9233361Z ^[[2m-^[[22m paths
ci	Format check (affected)	2026-05-31T16:04:03.9233625Z ^[[2m-^[[22m types
ci	Format check (affected)	2026-05-31T16:04:03.9233879Z ^[[2m-^[[22m log
ci	Format check (affected)	2026-05-31T16:04:03.9234017Z 
ci	Format check (affected)	2026-05-31T16:04:03.9234154Z ^[[2m^[[36m^[[39m^[[22m
ci	Format check (affected)	2026-05-31T16:04:04.1250009Z 
ci	Format check (affected)	2026-05-31T16:04:04.1251713Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:"fmt:check"
ci	Format check (affected)	2026-05-31T16:04:04.1252174Z 
ci	Format check (affected)	2026-05-31T16:04:04.1252637Z ^[[2m> ^[[22moxfmt --check packages/types/src
ci	Format check (affected)	2026-05-31T16:04:04.1253018Z 
ci	Format check (affected)	2026-05-31T16:04:04.1253229Z Checking formatting...
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
ci	Format check (affected)	﻿2026-05-31T15:58:43.8610174Z ##[group]Run bun run fmt:ci
ci	Format check (affected)	2026-05-31T15:58:43.8610499Z ^[[36;1mbun run fmt:ci^[[0m
ci	Format check (affected)	2026-05-31T15:58:43.8638341Z shell: /usr/bin/bash -e {0}
ci	Format check (affected)	2026-05-31T15:58:43.8638622Z env:
ci	Format check (affected)	2026-05-31T15:58:43.8638886Z   NX_BASE: f0086928abadeb63913b4703707b32e6aa205702
ci	Format check (affected)	2026-05-31T15:58:43.8639245Z   NX_HEAD: 3815e72d5cd490c58ba1c7b403566a4d84d6eccd
ci	Format check (affected)	2026-05-31T15:58:43.8639550Z ##[endgroup]
ci	Format check (affected)	2026-05-31T15:58:43.8709870Z $ nx affected -t fmt:check --exclude=ui
ci	Format check (affected)	2026-05-31T15:58:44.1296778Z 
ci	Format check (affected)	2026-05-31T15:58:44.1301755Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1mf0086928abadeb63913b4703707b32e6aa205702^[[22m^[[39m
ci	Format check (affected)	2026-05-31T15:58:44.1303160Z 
ci	Format check (affected)	2026-05-31T15:58:44.1303186Z 
ci	Format check (affected)	2026-05-31T15:58:44.1305140Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m3815e72d5cd490c58ba1c7b403566a4d84d6eccd^[[22m^[[39m
ci	Format check (affected)	2026-05-31T15:58:44.1306546Z 
ci	Format check (affected)	2026-05-31T15:58:44.6959708Z 
ci	Format check (affected)	2026-05-31T15:58:44.6961737Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m  ^[[36mRunning target ^[[1mfmt:check^[[22m for 21 projects:^[[39m
ci	Format check (affected)	2026-05-31T15:58:44.6962155Z 
ci	Format check (affected)	2026-05-31T15:58:44.6962386Z ^[[2m-^[[22m agent
ci	Format check (affected)	2026-05-31T15:58:44.6962711Z ^[[2m-^[[22m shell
ci	Format check (affected)	2026-05-31T15:58:44.6962959Z ^[[2m-^[[22m core
ci	Format check (affected)	2026-05-31T15:58:44.6963204Z ^[[2m-^[[22m loop
ci	Format check (affected)	2026-05-31T15:58:44.6963437Z ^[[2m-^[[22m mcp
ci	Format check (affected)	2026-05-31T15:58:44.6963735Z ^[[2m-^[[22m agent-protocol
ci	Format check (affected)	2026-05-31T15:58:44.6964047Z ^[[2m-^[[22m adapter-codex
ci	Format check (affected)	2026-05-31T15:58:44.6964337Z ^[[2m-^[[22m engine
ci	Format check (affected)	2026-05-31T15:58:44.6964605Z ^[[2m-^[[22m change-store
ci	Format check (affected)	2026-05-31T15:58:44.6964887Z ^[[2m-^[[22m openspec
ci	Format check (affected)	2026-05-31T15:58:44.6965155Z ^[[2m-^[[22m telemetry
ci	Format check (affected)	2026-05-31T15:58:44.6965431Z ^[[2m-^[[22m events
ci	Format check (affected)	2026-05-31T15:58:44.6965691Z ^[[2m-^[[22m cli-args
ci	Format check (affected)	2026-05-31T15:58:44.6965945Z ^[[2m-^[[22m context
ci	Format check (affected)	2026-05-31T15:58:44.6966206Z ^[[2m-^[[22m workflow
ci	Format check (affected)	2026-05-31T15:58:44.6966456Z ^[[2m-^[[22m content
ci	Format check (affected)	2026-05-31T15:58:44.6966721Z ^[[2m-^[[22m version
ci	Format check (affected)	2026-05-31T15:58:44.6966967Z ^[[2m-^[[22m output
ci	Format check (affected)	2026-05-31T15:58:44.6967226Z ^[[2m-^[[22m paths
ci	Format check (affected)	2026-05-31T15:58:44.6967472Z ^[[2m-^[[22m types
ci	Format check (affected)	2026-05-31T15:58:44.6967716Z ^[[2m-^[[22m log
ci	Format check (affected)	2026-05-31T15:58:44.6967846Z 
ci	Format check (affected)	2026-05-31T15:58:44.6967983Z ^[[2m^[[36m^[[39m^[[22m
ci	Format check (affected)	2026-05-31T15:58:44.8619422Z 
ci	Format check (affected)	2026-05-31T15:58:44.8620984Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:"fmt:check"
ci	Format check (affected)	2026-05-31T15:58:44.8621281Z 
ci	Format check (affected)	2026-05-31T15:58:44.8621581Z ^[[2m> ^[[22moxfmt --check packages/types/src
ci	Format check (affected)	2026-05-31T15:58:44.8621815Z 
ci	Format check (affected)	2026-05-31T15:58:44.8621957Z Checking formatting...
ci
…[truncated 17477 chars]
```
```

