## Fix failing CI checks (2026-05-21T17:02:49.418Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26240739180 ---
ci Circular dependency check ﻿2026-05-21T17:01:31.0832326Z ##[group]Run bun run check:circular:ci
ci Circular dependency check 2026-05-21T17:01:31.0832607Z ^[[36;1mbun run check:circular:ci^[[0m
ci Circular dependency check 2026-05-21T17:01:31.0869127Z shell: /usr/bin/bash -e {0}
ci Circular dependency check 2026-05-21T17:01:31.0869517Z env:
ci Circular dependency check 2026-05-21T17:01:31.0869723Z NX_BASE: 66d894154d8e3b74fe2e143c691de51d308446b3
ci Circular dependency check 2026-05-21T17:01:31.0870013Z NX_HEAD: e13a3b0d8fc088017b8b2e81e0bb65d59f552cc8
ci Circular dependency check 2026-05-21T17:01:31.0870245Z ##[endgroup]
ci Circular dependency check 2026-05-21T17:01:31.1039044Z $ depcruise packages/_/src apps/_/src --config .dependency-cruiser.cjs
ci Circular dependency check 2026-05-21T17:01:32.5166001Z
ci Circular dependency check 2026-05-21T17:01:32.5167059Z error no-circular: apps/agent/src/queue/queue-order.ts →
ci Circular dependency check 2026-05-21T17:01:32.5167620Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-21T17:01:32.5168147Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-21T17:01:32.5168642Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-21T17:01:32.5169006Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5169578Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5170140Z apps/agent/src/queue/queue-order.ts
ci Circular dependency check 2026-05-21T17:01:32.5170709Z error no-circular: apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-21T17:01:32.5171309Z apps/agent/src/shared/capabilities/poll-context.ts →
ci Circular dependency check 2026-05-21T17:01:32.5171794Z apps/agent/src/agent/pr.ts →
ci Circular dependency check 2026-05-21T17:01:32.5172251Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-21T17:01:32.5172578Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-21T17:01:32.5172907Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-21T17:01:32.5173187Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5173473Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5173731Z apps/agent/src/features/types.ts
ci Circular dependency check 2026-05-21T17:01:32.5174069Z error no-circular: apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-21T17:01:32.5174365Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-21T17:01:32.5174670Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-21T17:01:32.5174986Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-21T17:01:32.5175273Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5175545Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-21T17:01:32.5175793Z apps/agent/src/features/types.ts
ci Circular dependency check 2026-05-21T17:01:32.5176128Z error no-circular: apps/agent/src/features/stuck/index.ts →
ci Circular dependency check 2026-05-21T17:01:32.5176454Z apps/agent/src/features/stuck/run.ts →
ci Circular dependency check 2026-05-21T17:01:32.5176721Z apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-21T17:01:32.5176978Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-21T17:01:32.5177268Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-21T17:01:32.5177574Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-21T17:01:32.5177861Z apps/agent/src/agent/coordinator
…[truncated 37625 chars]

```

```

## Fix failing CI checks (2026-05-21T16:54:32.032Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26240347389 ---
ci Typecheck (affected) ﻿2026-05-21T16:53:33.5042967Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-21T16:53:33.5043298Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-21T16:53:33.5079715Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-21T16:53:33.5079974Z env:
ci Typecheck (affected) 2026-05-21T16:53:33.5080212Z NX_BASE: 66d894154d8e3b74fe2e143c691de51d308446b3
ci Typecheck (affected) 2026-05-21T16:53:33.5080557Z NX_HEAD: 1d1fc21d78df5bc438b5ecd92d1afb0ed1c899ce
ci Typecheck (affected) 2026-05-21T16:53:33.5080896Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-21T16:53:33.5081387Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T16:53:33.5157365Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-21T16:53:33.7697458Z
ci Typecheck (affected) 2026-05-21T16:53:33.7701917Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1m66d894154d8e3b74fe2e143c691de51d308446b3^[[22m^[[39m
ci Typecheck (affected) 2026-05-21T16:53:33.7703242Z
ci Typecheck (affected) 2026-05-21T16:53:33.7703256Z
ci Typecheck (affected) 2026-05-21T16:53:33.7705349Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1m1d1fc21d78df5bc438b5ecd92d1afb0ed1c899ce^[[22m^[[39m
ci Typecheck (affected) 2026-05-21T16:53:33.7706672Z
ci Typecheck (affected) 2026-05-21T16:53:34.1693742Z
ci Typecheck (affected) 2026-05-21T16:53:34.1695915Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^[[36mRunning target ^[[1mtypecheck^[[22m for 11 projects and ^[[1m9^[[22m tasks they depend on:^[[39m
ci Typecheck (affected) 2026-05-21T16:53:34.1696510Z
ci Typecheck (affected) 2026-05-21T16:53:34.1696655Z ^[[2m-^[[22m agent
ci Typecheck (affected) 2026-05-21T16:53:34.1696906Z ^[[2m-^[[22m shell
ci Typecheck (affected) 2026-05-21T16:53:34.1697186Z ^[[2m-^[[22m types
ci Typecheck (affected) 2026-05-21T16:53:34.1697450Z ^[[2m-^[[22m adapter-codex
ci Typecheck (affected) 2026-05-21T16:53:34.1697731Z ^[[2m-^[[22m engine
ci Typecheck (affected) 2026-05-21T16:53:34.1697964Z ^[[2m-^[[22m loop
ci Typecheck (affected) 2026-05-21T16:53:34.1698216Z ^[[2m-^[[22m cli-args
ci Typecheck (affected) 2026-05-21T16:53:34.1698458Z ^[[2m-^[[22m context
ci Typecheck (affected) 2026-05-21T16:53:34.1698690Z ^[[2m-^[[22m core
ci Typecheck (affected) 2026-05-21T16:53:34.1698907Z ^[[2m-^[[22m mcp
ci Typecheck (affected) 2026-05-21T16:53:34.1699143Z ^[[2m-^[[22m workflow
ci Typecheck (affected) 2026-05-21T16:53:34.1699275Z
ci Typecheck (affected) 2026-05-21T16:53:34.1699393Z ^[[2m^[[36m^[[39m^[[22m
ci Typecheck (affected) 2026-05-21T16:53:35.9020815Z
ci Typecheck (affected) 2026-05-21T16:53:35.9022377Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m types:typecheck
ci Typecheck (affected) 2026-05-21T16:53:35.9022838Z
ci Typecheck (affected) 2026-05-21T16:53:35.9023323Z ^[[2m> ^[[22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-21T16:53:35.9023680Z
ci Typecheck (affected) 2026-05-21T16:53:37.0252390Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T16:53:37.0253255Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m context:typecheck
ci Typecheck (affected) 2026-05-21T16:53:37.0253534Z
ci Typecheck (affected) 2026-05-21T16:53:37.0253842Z ^[[2m> ^[[22mtsc -b packages/context/tsconfig.json
ci Typecheck (affected) 2026-05-21T16:53:37.0254132Z
ci Typecheck (affected) 2026-05-21T16:53:38.0997466Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T16:53:38.0998550Z ##[group]✅ ^[[2m> ^[[22m^[[2mnx run^[[22m output:typecheck
ci Typecheck (affected) 2026-05-21T16:53:38.0998966Z
ci Typecheck (affected) 2026-05-21T16:53:38.0999394Z ^[[2m> ^[[22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-21T16:53:38.0999762Z
ci Typecheck (affected)
…[truncated 51171 chars]

```

```
