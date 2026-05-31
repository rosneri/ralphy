## Fix failing CI checks (2026-05-31T13:28:05.541Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26713870813 ---
ci Typecheck (affected) ﻿2026-05-31T13:26:13.6732932Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-31T13:26:13.6733440Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-31T13:26:13.6762650Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-31T13:26:13.6762955Z env:
ci Typecheck (affected) 2026-05-31T13:26:13.6763233Z NX_BASE: 0e30a6f59e58a0139c844bb6507ed2cfdbd6d1be
ci Typecheck (affected) 2026-05-31T13:26:13.6763618Z NX_HEAD: 8789e874d4b88d390b33dfb1a056f1842e88c0b2
ci Typecheck (affected) 2026-05-31T13:26:13.6763986Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-31T13:26:13.6764305Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T13:26:13.6837113Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-31T13:26:13.9429649Z
ci Typecheck (affected) 2026-05-31T13:26:13.9433947Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m0e30a6f59e58a0139c844bb6507ed2cfdbd6d1be^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T13:26:13.9435323Z
ci Typecheck (affected) 2026-05-31T13:26:13.9435336Z
ci Typecheck (affected) 2026-05-31T13:26:13.9437136Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m8789e874d4b88d390b33dfb1a056f1842e88c0b2^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T13:26:13.9438485Z
ci Typecheck (affected) 2026-05-31T13:26:14.3582978Z
ci Typecheck (affected) 2026-05-31T13:26:14.3584476Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 21 projects:^[[39m
ci Typecheck (affected) 2026-05-31T13:26:14.3584897Z
ci Typecheck (affected) 2026-05-31T13:26:14.3585131Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-31T13:26:14.3585426Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-31T13:26:14.3585733Z ^[[2m-^[[22m agent-protocol
ci Typecheck (affected) 2026-05-31T13:26:14.3586066Z ^[[2m-^[[22m adapter-codex
ci Typecheck (affected) 2026-05-31T13:26:14.3586382Z ^[[2m-^[[22m engine
ci Typecheck (affected) 2026-05-31T13:26:14.3586649Z ^[[2m-^[[22m loop
ci Typecheck (affected) 2026-05-31T13:26:14.3586939Z ^[[2m-^[[22m change-store
ci Typecheck (affected) 2026-05-31T13:26:14.3587236Z ^[[2m-^[[22m openspec
ci Typecheck (affected) 2026-05-31T13:26:14.3587503Z ^[[2m-^[[22m mcp
ci Typecheck (affected) 2026-05-31T13:26:14.3587758Z ^[[2m-^[[22m core
ci Typecheck (affected) 2026-05-31T13:26:14.3588041Z ^[[2m-^[[22m telemetry
ci Typecheck (affected) 2026-05-31T13:26:14.3588323Z ^[[2m-^[[22m events
ci Typecheck (affected) 2026-05-31T13:26:14.3588605Z ^[[2m-^[[22m cli-args
ci Typecheck (affected) 2026-05-31T13:26:14.3588883Z ^[[2m-^[[22m context
ci Typecheck (affected) 2026-05-31T13:26:14.3589198Z ^[[2m-^[[22m workflow
ci Typecheck (affected) 2026-05-31T13:26:14.3589625Z ^[[2m-^[[22m content
ci Typecheck (affected) 2026-05-31T13:26:14.3590054Z ^[[2m-^[[22m version
ci Typecheck (affected) 2026-05-31T13:26:14.3590457Z ^[[2m-^[[22m output
ci Typecheck (affected) 2026-05-31T13:26:14.3590834Z ^[[2m-^[[22m paths
ci Typecheck (affected) 2026-05-31T13:26:14.3591126Z ^[[2m-^[[22m types
ci Typecheck (affected) 2026-05-31T13:26:14.3591373Z ^[[2m-^[[22m log
ci Typecheck (affected) 2026-05-31T13:26:14.3591511Z
ci Typecheck (affected) 2026-05-31T13:26:14.3591651Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-31T13:26:16.1442474Z
ci Typecheck (affected) 2026-05-31T13:26:16.1443766Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-31T13:26:16.1444075Z
ci Typecheck (affected) 2026-05-31T13:26:16.1444396Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-31T13:26:16.1444654Z
ci Typecheck (affected) 2026-05-31T13:26:17.2219181Z ##[endgroup]
ci Typecheck (affected) 2026-
…[truncated 232777 chars]

```

```
