## Fix failing CI checks (2026-05-31T11:34:19.889Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26711419264 ---
ci Typecheck (affected) ﻿2026-05-31T11:32:30.6974914Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-31T11:32:30.6975268Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-31T11:32:30.6991359Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-31T11:32:30.6991645Z env:
ci Typecheck (affected) 2026-05-31T11:32:30.6991880Z NX_BASE: 4e5082103c3531bac5d7480c2897fe2cb813aa48
ci Typecheck (affected) 2026-05-31T11:32:30.6992227Z NX_HEAD: 841147088ecf047918a43181887ce86602ddb3f0
ci Typecheck (affected) 2026-05-31T11:32:30.6992575Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-31T11:32:30.6992858Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:32:30.7042467Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-31T11:32:30.9318408Z
ci Typecheck (affected) 2026-05-31T11:32:30.9322295Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m4e5082103c3531bac5d7480c2897fe2cb813aa48^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T11:32:30.9323639Z
ci Typecheck (affected) 2026-05-31T11:32:30.9323654Z
ci Typecheck (affected) 2026-05-31T11:32:30.9325642Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m841147088ecf047918a43181887ce86602ddb3f0^[[22m^[[39m
ci Typecheck (affected) 2026-05-31T11:32:30.9327027Z
ci Typecheck (affected) 2026-05-31T11:32:31.3914981Z
ci Typecheck (affected) 2026-05-31T11:32:31.3916690Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 2 projects and ^[[1m17^[[22m tasks they depend on:^[[39m
ci Typecheck (affected) 2026-05-31T11:32:31.3917651Z
ci Typecheck (affected) 2026-05-31T11:32:31.3917898Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-31T11:32:31.3918490Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-31T11:32:31.3918709Z
ci Typecheck (affected) 2026-05-31T11:32:31.3918938Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-31T11:32:33.3466012Z
ci Typecheck (affected) 2026-05-31T11:32:33.3467802Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-31T11:32:33.3468515Z
ci Typecheck (affected) 2026-05-31T11:32:33.3469207Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:32:33.3469826Z
ci Typecheck (affected) 2026-05-31T11:32:34.4488491Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:32:34.4489672Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m version:typecheck
ci Typecheck (affected) 2026-05-31T11:32:34.4490157Z
ci Typecheck (affected) 2026-05-31T11:32:34.4490664Z ^[[2m> ^[[22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:32:34.4491414Z
ci Typecheck (affected) 2026-05-31T11:32:35.6610887Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:32:35.6612103Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m cli-args:typecheck
ci Typecheck (affected) 2026-05-31T11:32:35.6612611Z
ci Typecheck (affected) 2026-05-31T11:32:35.6613111Z ^[[2m> ^[[22mtsc -b packages/cli-args/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:32:35.6613555Z
ci Typecheck (affected) 2026-05-31T11:32:36.9297006Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:32:36.9297889Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m context:typecheck
ci Typecheck (affected) 2026-05-31T11:32:36.9298168Z
ci Typecheck (affected) 2026-05-31T11:32:36.9298452Z ^[[2m> ^[[22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-31T11:32:36.9298683Z
ci Typecheck (affected) 2026-05-31T11:32:37.9301911Z ##[endgroup]
ci Typecheck (affected) 2026-05-31T11:32:37.9303482Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m output:typecheck
ci Typecheck (affected) 2026-05-31T11:32:37.9304130Z
ci Typecheck (affected) 2026-05-31T11:32:37.9304813Z ^[[2m
…[truncated 9864 chars]

```

```
