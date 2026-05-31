## Fix failing CI checks (2026-05-31T11:14:28.443Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26711007386 ---
ci Typecheck (affected) ﻿2026-05-31T11:12:35.0446842Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-31T11:12:35.0447200Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-31T11:12:35.0464292Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-31T11:12:35.0464621Z env:
ci Typecheck (affected) 2026-05-31T11:12:35.0464889Z NX_BASE: 93d7ccb88566f33d9398f61fa1d2c51c6d1167b4
ci Typecheck (affected) 2026-05-31T11:12:35.0465266Z NX_HEAD: d739b7e2bd431bccbf1fb4dd42494a528a752e60
ci Typecheck (affected) 2026-05-31T11:12:35.0465660Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-31T11:12:35.0465968Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:12:35.0516736Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-31T11:12:35.2733603Z
ci Typecheck (affected) 2026-05-31T11:12:35.2738276Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m93d7ccb88566f33d9398f61fa1d2c51c6d1167b4^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T11:12:35.2739697Z
ci Typecheck (affected) 2026-05-31T11:12:35.2739713Z
ci Typecheck (affected) 2026-05-31T11:12:35.2741528Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1md739b7e2bd431bccbf1fb4dd42494a528a752e60^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T11:12:35.2742925Z
ci Typecheck (affected) 2026-05-31T11:12:35.6372089Z
ci Typecheck (affected) 2026-05-31T11:12:35.6373498Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 2 projects and ^[[1m17^[[22m tasks they depend on:^[[39m
ci Typecheck (affected) 2026-05-31T11:12:35.6373979Z
ci Typecheck (affected) 2026-05-31T11:12:35.6374187Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-31T11:12:35.6374451Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-31T11:12:35.6374589Z
ci Typecheck (affected) 2026-05-31T11:12:35.6374732Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-31T11:12:37.3017536Z
ci Typecheck (affected) 2026-05-31T11:12:37.3018961Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-31T11:12:37.3019241Z
ci Typecheck (affected) 2026-05-31T11:12:37.3019540Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:12:37.3019771Z
ci Typecheck (affected) 2026-05-31T11:12:38.2690774Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:12:38.2691658Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m version:typecheck
ci Typecheck (affected) 2026-05-31T11:12:38.2691939Z
ci Typecheck (affected) 2026-05-31T11:12:38.2692219Z ^[[2m> ^[[22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:12:38.2692673Z
ci Typecheck (affected) 2026-05-31T11:12:39.3967327Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:12:39.3968466Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m cli-args:typecheck
ci Typecheck (affected) 2026-05-31T11:12:39.3968869Z
ci Typecheck (affected) 2026-05-31T11:12:39.3969350Z ^[[2m> ^[[22mtsc -b packages/cli-args/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:12:39.3969819Z
ci Typecheck (affected) 2026-05-31T11:12:40.6618775Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:12:40.6619595Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m context:typecheck
ci Typecheck (affected) 2026-05-31T11:12:40.6620100Z
ci Typecheck (affected) 2026-05-31T11:12:40.6620400Z ^[[2m> ^[[22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:12:40.6620636Z
ci Typecheck (affected) 2026-05-31T11:12:41.7918067Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:12:41.7919279Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m output:typecheck
ci Typecheck (affected) 2026-05-31T11:12:41.7919770Z
ci Typecheck (affected) 2026-05-31T11:12:41.7920283Z ^[[2m
…[truncated 10142 chars]

```

```
