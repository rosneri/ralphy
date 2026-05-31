## Fix failing CI checks (2026-05-31T15:58:03.677Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```
--- run 26717336918 ---
ci	Typecheck (affected)	﻿2026-05-31T15:57:09.9626044Z ##[group]Run bun run typecheck:ci
ci	Typecheck (affected)	2026-05-31T15:57:09.9626404Z ^[[36;1mbun run typecheck:ci^[[0m
ci	Typecheck (affected)	2026-05-31T15:57:09.9653952Z shell: /usr/bin/bash -e {0}
ci	Typecheck (affected)	2026-05-31T15:57:09.9654267Z env:
ci	Typecheck (affected)	2026-05-31T15:57:09.9654544Z   NX_BASE: e4168928df8e554ed3770373e14c6449e5ffb1cd
ci	Typecheck (affected)	2026-05-31T15:57:09.9654947Z   NX_HEAD: 9342f8a6e2adef13962879c6c793a86d651033c9
ci	Typecheck (affected)	2026-05-31T15:57:09.9655348Z   NODE_OPTIONS: --max-old-space-size=8192
ci	Typecheck (affected)	2026-05-31T15:57:09.9655682Z ##[endgroup]
ci	Typecheck (affected)	2026-05-31T15:57:09.9726228Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci	Typecheck (affected)	2026-05-31T15:57:10.2330461Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.2335182Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1me4168928df8e554ed3770373e14c6449e5ffb1cd^[[22m^[[39m
ci	Typecheck (affected)	2026-05-31T15:57:10.2336618Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.2336631Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.2343297Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m  ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m9342f8a6e2adef13962879c6c793a86d651033c9^[[22m^[[39m
ci	Typecheck (affected)	2026-05-31T15:57:10.2351508Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.6939811Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.6941764Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m  ^[[36mRunning target ^[[1mtypecheck^[[22m for 2 projects and ^[[1m17^[[22m tasks they depend on:^[[39m
ci	Typecheck (affected)	2026-05-31T15:57:10.6942590Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.6942756Z ^[[2m-^[[22m agent
ci	Typecheck (affected)	2026-05-31T15:57:10.6943182Z ^[[2m-^[[22m shell
ci	Typecheck (affected)	2026-05-31T15:57:10.6943351Z 
ci	Typecheck (affected)	2026-05-31T15:57:10.6943805Z ^[[2m^[[36m^[[39m^[[22m
ci	Typecheck (affected)	2026-05-31T15:57:12.5707473Z 
ci	Typecheck (affected)	2026-05-31T15:57:12.5708895Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci	Typecheck (affected)	2026-05-31T15:57:12.5709208Z 
ci	Typecheck (affected)	2026-05-31T15:57:12.5709528Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci	Typecheck (affected)	2026-05-31T15:57:12.5709796Z 
ci	Typecheck (affected)	2026-05-31T15:57:13.5833093Z ##[endgroup]
ci	Typecheck (affected)	2026-05-31T15:57:13.5833969Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m version:typecheck
ci	Typecheck (affected)	2026-05-31T15:57:13.5834281Z 
ci	Typecheck (affected)	2026-05-31T15:57:13.5834694Z ^[[2m> ^[[22mtsc -b packages/version/tsconfig.json
ci	Typecheck (affected)	2026-05-31T15:57:13.5835041Z 
ci	Typecheck (affected)	2026-05-31T15:57:14.6906282Z ##[endgroup]
ci	Typecheck (affected)	2026-05-31T15:57:14.6907452Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m cli-args:typecheck
ci	Typecheck (affected)	2026-05-31T15:57:14.6907918Z 
ci	Typecheck (affected)	2026-05-31T15:57:14.6908430Z ^[[2m> ^[[22mtsc -b packages/cli-args/tsconfig.json
ci	Typecheck (affected)	2026-05-31T15:57:14.6908831Z 
ci	Typecheck (affected)	2026-05-31T15:57:15.8534994Z ##[endgroup]
ci	Typecheck (affected)	2026-05-31T15:57:15.8536161Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m context:typecheck
ci	Typecheck (affected)	2026-05-31T15:57:15.8536603Z 
ci	Typecheck (affected)	2026-05-31T15:57:15.8537067Z ^[[2m> ^[[22mtsc -b packages/context/tsconfig.json
ci	Typecheck (affected)	2026-05-31T15:57:15.8537497Z 
ci	Typecheck (affected)	2026-05-31T15:57:16.9412268Z ##[endgroup]
ci	Typecheck (affected)	2026-05-31T15:57:16.9413443Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m output:typecheck
ci	Typecheck (affected)	2026-05-31T15:57:16.9413892Z 
ci	Typecheck (affected)	2026-05-31T15:57:16.9414355Z ^[[2m
…[truncated 7993 chars]
```
```

