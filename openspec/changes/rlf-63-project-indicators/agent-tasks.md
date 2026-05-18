## Fix failing CI checks (2026-05-18T07:19:21.106Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26019170065 ---
ci Test affected files + coverage ﻿2026-05-18T07:18:21.7406544Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-18T07:18:21.7407261Z ^[[36;1mbun run test:affected-files:coverage:ci^[[0m
ci Test affected files + coverage 2026-05-18T07:18:21.7456297Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-18T07:18:21.7456797Z env:
ci Test affected files + coverage 2026-05-18T07:18:21.7457222Z NX_BASE: 7e7d6b912f7c1fa605d55ad549b769d5fdf3c7ff
ci Test affected files + coverage 2026-05-18T07:18:21.7457878Z NX_HEAD: 1f0079ab097f224c4cde600aa81f58d17bc4cca8
ci Test affected files + coverage 2026-05-18T07:18:21.7458413Z ##[endgroup]
ci Test affected files + coverage 2026-05-18T07:18:21.7545667Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-18T07:18:21.7778365Z Detecting affected projects...
ci Test affected files + coverage 2026-05-18T07:18:21.7778705Z
ci Test affected files + coverage 2026-05-18T07:18:27.9332630Z agent: 9 relevant test file(s)
ci Test affected files + coverage 2026-05-18T07:18:27.9333587Z apps/agent/src/**tests**/agent-mode-steering.test.tsx
ci Test affected files + coverage 2026-05-18T07:18:27.9334236Z apps/agent/src/**tests**/agent.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9334677Z apps/agent/src/**tests**/coordinator-restart-worker.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9335107Z apps/agent/src/**tests**/coordinator.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9335562Z apps/agent/src/**tests**/linear-project-indicator.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9336003Z apps/agent/src/**tests**/linear.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9336336Z apps/agent/src/**tests**/post-task.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9336661Z apps/agent/src/**tests**/pr.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9337000Z apps/agent/src/**tests**/queue-order.test.ts
ci Test affected files + coverage 2026-05-18T07:18:27.9337219Z
ci Test affected files + coverage 2026-05-18T07:18:27.9347449Z bun test v1.3.14 (0d9b296a)
ci Test affected files + coverage 2026-05-18T07:18:27.9440746Z
ci Test affected files + coverage 2026-05-18T07:18:27.9441543Z ##[group]src/**tests**/wire-setup-worktree.test.ts:
ci Test affected files + coverage 2026-05-18T07:18:28.1122570Z (pass) setupWorktree — RLF-39: worktree creation failure must not fall back to projectRoot > useWorktree:true + createWorktree throws → no scaffold lands in projectRoot, red log emitted [58.65ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1290290Z (pass) setupWorktree — RLF-39: worktree creation failure must not fall back to projectRoot > useWorktree:false preserves projectRoot fallback when no worktree is created [16.90ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1291080Z
ci Test affected files + coverage 2026-05-18T07:18:28.1291448Z ##[endgroup]
ci Test affected files + coverage 2026-05-18T07:18:28.1291579Z
ci Test affected files + coverage 2026-05-18T07:18:28.1291881Z ##[group]src/**tests**/worktree-mcp-seed.test.ts:
ci Test affected files + coverage 2026-05-18T07:18:28.1314560Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.1 copies project .mcp.json into worktree [1.08ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1319617Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.2 rewrites .ralph/ relative args to absolute paths under projectRoot [0.72ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1323676Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.3 no-op when neither project nor worktree has .mcp.json [0.40ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1329915Z (pass) seedWorktreeMcpConfig (§1 manual plan) > §1.4 worktree's existing .mcp.json takes precedence over project's [0.63ms]
ci Test affected files + coverage 2026-05-18T07:18:28.1
…[truncated 143017 chars]

```

```

## Resolve PR merge conflicts (2026-05-18T07:15:22.378Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR https://github.com/NeriRos/ralphy/pull/190 has merge conflicts with `main`.

Steps:
1. `git fetch origin main` then rebase or merge `main` into the current branch.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution.
```

## Fix failing CI checks (2026-05-18T06:55:37.961Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26018242438 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-18T06:53:40.2285003Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2285716Z ^[[36;1mbun scripts/check-static-error-messages.ts^[[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2334915Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2335351Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2335742Z NX_BASE: e8899e90d8c35e83f1eb0560c7f044976d56a001
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2336334Z NX_HEAD: fae6c3361a52d6022064265fd88e8eab39e573f8
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2336918Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2924962Z ✘ Found 1 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2925538Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2925765Z apps/agent/src/agent/wire.ts:528
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2926403Z throw new Error(`Linear project not found: ${m.value}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2926803Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2927352Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2928468Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-18T06:53:40.2966272Z ##[error]Process completed with exit code 1.
ci Typecheck (affected) ﻿2026-05-18T06:53:44.5890103Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-18T06:53:44.5890452Z ^[[36;1mbun run typecheck:ci^[[0m
ci Typecheck (affected) 2026-05-18T06:53:44.5926595Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-18T06:53:44.5926866Z env:
ci Typecheck (affected) 2026-05-18T06:53:44.5927123Z NX_BASE: e8899e90d8c35e83f1eb0560c7f044976d56a001
ci Typecheck (affected) 2026-05-18T06:53:44.5927482Z NX_HEAD: fae6c3361a52d6022064265fd88e8eab39e573f8
ci Typecheck (affected) 2026-05-18T06:53:44.5927866Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-18T06:53:44.5928160Z ##[endgroup]
ci Typecheck (affected) 2026-05-18T06:53:44.6004643Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-18T06:53:44.8533434Z
ci Typecheck (affected) 2026-05-18T06:53:44.8537742Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: ^[[1me8899e90d8c35e83f1eb0560c7f044976d56a001^[[22m^[[39m
ci Typecheck (affected) 2026-05-18T06:53:44.8539313Z
ci Typecheck (affected) 2026-05-18T06:53:44.8539329Z
ci Typecheck (affected) 2026-05-18T06:53:44.8541137Z ^[[7m^[[1m^[[38;5;214m NX ^[[39m^[[22m^[[27m ^[[38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: ^[[1mfae6c3361a52d6022064265fd88e8eab39e573f8^[[22m^[[39m
ci Typecheck (affected) 2026-05-18T06:53:44.8543975Z
ci Typecheck (affected) 2026-05-18T06:53:45.2320772Z
ci Typecheck (affected) 2026-05-18T06:53:45.2322348Z ^[[7m^[[1m^[[36m NX ^[[39m^[[22m^[[27m ^
…[truncated 167016 chars]

```

```
