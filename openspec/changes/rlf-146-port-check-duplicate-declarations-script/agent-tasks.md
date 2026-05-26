## Fix failing CI checks (2026-05-26T01:17:38.310Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26426728220 ---
ci Test affected files + coverage ﻿2026-05-26T01:16:25.0200399Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-26T01:16:25.0200804Z [36;1mbun run test:affected-files:coverage:ci[0m
ci Test affected files + coverage 2026-05-26T01:16:25.0237062Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-26T01:16:25.0237318Z env:
ci Test affected files + coverage 2026-05-26T01:16:25.0237557Z NX_BASE: 4967312c25a8eb54cbce078ed970b077f27ef9b3
ci Test affected files + coverage 2026-05-26T01:16:25.0237898Z NX_HEAD: de5a6ec15a46936188740b440e6891c326c80d40
ci Test affected files + coverage 2026-05-26T01:16:25.0238178Z ##[endgroup]
ci Test affected files + coverage 2026-05-26T01:16:25.0315794Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-26T01:16:25.0555360Z Detecting affected projects...
ci Test affected files + coverage 2026-05-26T01:16:25.0555766Z
ci Test affected files + coverage 2026-05-26T01:16:35.4126353Z agent: 14 relevant test file(s)
ci Test affected files + coverage 2026-05-26T01:16:35.4127085Z apps/agent/src/**tests**/agent-characterization.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4127650Z apps/agent/src/**tests**/agent-integration.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4128238Z apps/agent/src/**tests**/agent-mode-awaiting.test.tsx
ci Test affected files + coverage 2026-05-26T01:16:35.4128839Z apps/agent/src/**tests**/agent-mode-chip.test.tsx
ci Test affected files + coverage 2026-05-26T01:16:35.4129439Z apps/agent/src/**tests**/agent-mode-header.test.tsx
ci Test affected files + coverage 2026-05-26T01:16:35.4130277Z apps/agent/src/**tests**/agent-mode-show-all.test.tsx
ci Test affected files + coverage 2026-05-26T01:16:35.4130887Z apps/agent/src/**tests**/agent-mode-steering.test.tsx
ci Test affected files + coverage 2026-05-26T01:16:35.4131430Z apps/agent/src/**tests**/cli.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4132032Z apps/agent/src/**tests**/code-review-trigger-dedupe.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4132729Z apps/agent/src/**tests**/code-review-watermark.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4133347Z apps/agent/src/**tests**/mention-reaction.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4133958Z apps/agent/src/**tests**/wire-normalize-tasks.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4134783Z apps/agent/src/**tests**/wire-setup-worktree.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4135400Z apps/agent/src/hooks/**tests**/useTerminalSize.test.ts
ci Test affected files + coverage 2026-05-26T01:16:35.4135759Z
ci Test affected files + coverage 2026-05-26T01:16:35.4145094Z bun test v1.3.14 (0d9b296a)
ci Test affected files + coverage 2026-05-26T01:16:35.4374108Z
ci Test affected files + coverage 2026-05-26T01:16:35.4375100Z ##[group]src/**tests**/awaiting-confirmation.test.ts:
ci Test affected files + coverage 2026-05-26T01:16:35.4641734Z (pass) inspectAwaitingTicket — approval path > fires clearApproved + persists confirmedAt [1.00ms]
ci Test affected files + coverage 2026-05-26T01:16:35.4645741Z (pass) inspectAwaitingTicket — revise path > appends steering, restarts design, bumps rounds, resets confirmedAt [0.42ms]
ci Test affected files + coverage 2026-05-26T01:16:35.4648205Z (pass) inspectAwaitingTicket — revise path > ignores revise mention inside backticks (e.g. our own plan-ready template) [0.28ms]
ci Test affected files + coverage 2026-05-26T01:16:35.4650122Z (pass) inspectAwaitingTicket — revise path > ignores revise comments at or before lastReviseConsumedAt watermark [0.17ms]
ci Test affected files + coverage 2026-05-26T01:16:35.4653116Z (pass) inspectAwaitingTicket — revise wins over simultaneous approval (S11.2 regression) > revise comment takes precedence when both approval label and unconsumed revis
…[truncated 364089 chars]

```

```

## Fix failing CI checks (2026-05-26T01:13:14.433Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26426579626 ---
ci Unused dependency check ﻿2026-05-26T01:11:02.5357440Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-26T01:11:02.5357765Z [36;1mbun run check:unused:ci[0m
ci Unused dependency check 2026-05-26T01:11:02.5391630Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-26T01:11:02.5392120Z env:
ci Unused dependency check 2026-05-26T01:11:02.5392380Z NX_BASE: 4967312c25a8eb54cbce078ed970b077f27ef9b3
ci Unused dependency check 2026-05-26T01:11:02.5392733Z NX_HEAD: d2b4abe2b8640d3e36d9ae7f3330143ea65eba42
ci Unused dependency check 2026-05-26T01:11:02.5393035Z ##[endgroup]
ci Unused dependency check 2026-05-26T01:11:02.5469688Z $ knip
ci Unused dependency check 2026-05-26T01:11:06.7860037Z [93m[4mUnlisted dependencies[24m[39m (5)
ci Unused dependency check 2026-05-26T01:11:06.7943744Z @ralphy/ui-shared apps/agent/src/components/AgentMode.tsx:53:10  
ci Unused dependency check 2026-05-26T01:11:06.7944970Z @ralphy/ui-shared apps/agent/src/hooks/**tests**/useTerminalSize.test.ts:5:10
ci Unused dependency check 2026-05-26T01:11:06.7946177Z @ralphy/ui-shared apps/loop/src/components/StatusBar.tsx:4:10  
ci Unused dependency check 2026-05-26T01:11:06.7947336Z @ralphy/ui-shared apps/loop/src/components/TaskLoop.tsx:11:10  
ci Unused dependency check 2026-05-26T01:11:06.7948516Z @ralphy/ui-shared apps/loop/src/hooks/**tests**/useTerminalSize.test.ts:5:10
ci Unused dependency check 2026-05-26T01:11:06.7949559Z [93m[4mUnused exports[24m[39m (4)
ci Unused dependency check 2026-05-26T01:11:06.7950480Z ANSI_STRIP_RE apps/agent/src/shared/capabilities/output-utils.ts:1:14
ci Unused dependency check 2026-05-26T01:11:06.7951565Z BOX_ONLY_RE apps/agent/src/shared/capabilities/output-utils.ts:2:14
ci Unused dependency check 2026-05-26T01:11:06.7952908Z STATUS_BAR_LINE_RE apps/agent/src/shared/capabilities/output-utils.ts:3:14
ci Unused dependency check 2026-05-26T01:11:06.7953946Z ITER_HEADER_LINE_RE apps/agent/src/shared/capabilities/output-utils.ts:4:14
ci Unused dependency check 2026-05-26T01:11:06.8244315Z error: script "check:unused:ci" exited with code 1
ci Unused dependency check 2026-05-26T01:11:06.8254875Z ##[error]Process completed with exit code 1.
ci Test affected files + coverage ﻿2026-05-26T01:11:07.1233376Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-26T01:11:07.1233889Z [36;1mbun run test:affected-files:coverage:ci[0m
ci Test affected files + coverage 2026-05-26T01:11:07.1267505Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-26T01:11:07.1267753Z env:
ci Test affected files + coverage 2026-05-26T01:11:07.1267996Z NX_BASE: 4967312c25a8eb54cbce078ed970b077f27ef9b3
ci Test affected files + coverage 2026-05-26T01:11:07.1268340Z NX_HEAD: d2b4abe2b8640d3e36d9ae7f3330143ea65eba42
ci Test affected files + coverage 2026-05-26T01:11:07.1268632Z ##[endgroup]
ci Test affected files + coverage 2026-05-26T01:11:07.1342250Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-26T01:11:07.1572479Z Detecting affected projects...
ci Test affected files + coverage 2026-05-26T01:11:07.1572809Z
ci Test affected files + coverage 2026-05-26T01:11:17.6362591Z agent: 14 relevant test file(s)
ci Test affected files + coverage 2026-05-26T01:11:17.6363410Z apps/agent/src/**tests**/agent-characterization.test.ts
ci Test affected files + coverage 2026-05-26T01:11:17.6364174Z apps/agent/src/**tests**/agent-integration.test.ts
ci Test affected files + coverage 2026-05-26T01:11:17.6364878Z apps/agent/src/**tests**/agent-mode-awaiting.test.tsx
ci Test affected files + coverage 2026-05-26T01:11:17.6365584Z apps/agent/src/**tests**/agent-mode-chip.test.tsx
ci Test affected files + coverage 2026-05-26T01:11:17.6366306Z apps/agent/src/**tests**/agent-mode-header.test.tsx
ci Test affected files + coverage 2026-05-26T01:11:17.636706
…[truncated 366369 chars]

```

```

## Fix failing CI checks (2026-05-26T01:04:29.360Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26426223564 ---
ci Circular dependency check ﻿2026-05-26T00:57:38.2106631Z ##[group]Run bun run check:circular:ci
ci Circular dependency check 2026-05-26T00:57:38.2106920Z [36;1mbun run check:circular:ci[0m
ci Circular dependency check 2026-05-26T00:57:38.2136946Z shell: /usr/bin/bash -e {0}
ci Circular dependency check 2026-05-26T00:57:38.2137178Z env:
ci Circular dependency check 2026-05-26T00:57:38.2137390Z NX*BASE: 4967312c25a8eb54cbce078ed970b077f27ef9b3
ci Circular dependency check 2026-05-26T00:57:38.2137694Z NX_HEAD: 105a8abbfa0c81e1e50575c5558e529bec8b45ce
ci Circular dependency check 2026-05-26T00:57:38.2138119Z ##[endgroup]
ci Circular dependency check 2026-05-26T00:57:38.2202786Z $ depcruise packages/*/src apps/\_/src --config .dependency-cruiser.cjs
ci Circular dependency check 2026-05-26T00:57:39.9495021Z
ci Circular dependency check 2026-05-26T00:57:39.9496105Z error no-circular: apps/agent/src/queue/queue-order.ts →
ci Circular dependency check 2026-05-26T00:57:39.9496919Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-26T00:57:39.9497615Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-26T00:57:39.9498345Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-26T00:57:39.9498985Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9499616Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9500259Z apps/agent/src/queue/queue-order.ts
ci Circular dependency check 2026-05-26T00:57:39.9500973Z error no-circular: apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-26T00:57:39.9501751Z apps/agent/src/shared/capabilities/poll-context.ts →
ci Circular dependency check 2026-05-26T00:57:39.9502126Z apps/agent/src/agent/pr.ts →
ci Circular dependency check 2026-05-26T00:57:39.9502598Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-26T00:57:39.9503313Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-26T00:57:39.9503958Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-26T00:57:39.9504298Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9504615Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9505001Z apps/agent/src/features/types.ts
ci Circular dependency check 2026-05-26T00:57:39.9505688Z error no-circular: apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-26T00:57:39.9506317Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-26T00:57:39.9506946Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-26T00:57:39.9507578Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-26T00:57:39.9508144Z apps/agent/src/agent/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9508689Z apps/agent/src/runtime/coordinator.ts →
ci Circular dependency check 2026-05-26T00:57:39.9509177Z apps/agent/src/features/types.ts
ci Circular dependency check 2026-05-26T00:57:39.9509722Z error no-circular: apps/agent/src/features/stuck/index.ts →
ci Circular dependency check 2026-05-26T00:57:39.9510105Z apps/agent/src/features/stuck/run.ts →
ci Circular dependency check 2026-05-26T00:57:39.9510407Z apps/agent/src/features/types.ts →
ci Circular dependency check 2026-05-26T00:57:39.9510726Z apps/agent/src/agent/linear.ts →
ci Circular dependency check 2026-05-26T00:57:39.9511085Z apps/agent/src/shared/capabilities/linear-client.ts →
ci Circular dependency check 2026-05-26T00:57:39.9511815Z apps/agent/src/agent/wire/task-bodies.ts →
ci Circular dependency check 2026-05-26T00:57:39.9512294Z apps/agent/src/agent/coordinator.t
…[truncated 407834 chars]

```

```

## Manual Testing

- [x] `bun scripts/check-duplicate-declarations.ts --all` exits 0 and prints "✓ No duplication detected in the whole repo." — confirmed: all four detectors (same-name, TS2300, SonarJS, jscpd) report clean.
- [x] `bun scripts/check-duplicate-declarations.ts --diff` exits 0 and prints "✓ No duplication detected in files changed vs origin/main." — confirmed: diff-mode correctly scans only changed files against the whole repo.
- [x] `bun scripts/check-duplicate-declarations.ts --files apps/agent/src/index.ts` exits 0 with "✓ No duplication detected in 1 file(s)." — confirmed: explicit `--files` mode works correctly.
- [x] `bun scripts/check-ci-local-sync.ts` exits 0 — confirmed: "All 19 required ci.yml steps are present in ci-local.sh", including the "No duplicate declarations" step added at line 40.
- [x] Convention allowlist passes for multiple `main()` functions — confirmed: multiple apps define `main()` in `apps/*/src/index.ts` and `--all` scan exits clean; the allowlist exempts app entry-point `main()` declarations.
- [x] `useTerminalSize` hook is exported from `packages/ui-shared` and consumed by both `apps/agent` and `apps/loop` — confirmed: `apps/agent/src/components/AgentMode.tsx` and `apps/loop/src/components/StatusBar.tsx` import from `ui-shared`; `--all` scan exits clean meaning no residual duplicate `useTerminalSize` declarations remain.
- [x] Pre-push hook uses husky v9 format — confirmed: `.husky/pre-push` contains a single line `bun scripts/check-duplicate-declarations.ts --diff --no-ts2300 --no-sonar --no-jscpd` without the legacy `#!/bin/sh` + `npx husky` preamble.

## Fix failing CI checks (2026-05-26T00:48:34.437Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26425934442 ---
ci Format check (affected) ﻿2026-05-26T00:46:28.4887887Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-26T00:46:28.4888192Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-26T00:46:28.4924014Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-26T00:46:28.4924268Z env:
ci Format check (affected) 2026-05-26T00:46:28.4924505Z NX_BASE: 4967312c25a8eb54cbce078ed970b077f27ef9b3
ci Format check (affected) 2026-05-26T00:46:28.4924844Z NX_HEAD: 28e146b61c6bd41261eb96862887ab1c537ce910
ci Format check (affected) 2026-05-26T00:46:28.4925120Z ##[endgroup]
ci Format check (affected) 2026-05-26T00:46:28.5024978Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-26T00:46:28.7463556Z
ci Format check (affected) 2026-05-26T00:46:28.7467751Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m4967312c25a8eb54cbce078ed970b077f27ef9b3[22m[39m
ci Format check (affected) 2026-05-26T00:46:28.7468630Z
ci Format check (affected) 2026-05-26T00:46:28.7468639Z
ci Format check (affected) 2026-05-26T00:46:28.7469668Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m28e146b61c6bd41261eb96862887ab1c537ce910[22m[39m
ci Format check (affected) 2026-05-26T00:46:28.7470425Z
ci Format check (affected) 2026-05-26T00:46:29.4510784Z
ci Format check (affected) 2026-05-26T00:46:29.4512592Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 21 projects:[39m
ci Format check (affected) 2026-05-26T00:46:29.4513220Z
ci Format check (affected) 2026-05-26T00:46:29.4513419Z [2m-[22m agent
ci Format check (affected) 2026-05-26T00:46:29.4513834Z [2m-[22m shell
ci Format check (affected) 2026-05-26T00:46:29.4514184Z [2m-[22m loop
ci Format check (affected) 2026-05-26T00:46:29.4514579Z [2m-[22m agent-protocol
ci Format check (affected) 2026-05-26T00:46:29.4514988Z [2m-[22m adapter-codex
ci Format check (affected) 2026-05-26T00:46:29.4515363Z [2m-[22m engine
ci Format check (affected) 2026-05-26T00:46:29.4515705Z [2m-[22m change-store
ci Format check (affected) 2026-05-26T00:46:29.4516079Z [2m-[22m openspec
ci Format check (affected) 2026-05-26T00:46:29.4516422Z [2m-[22m mcp
ci Format check (affected) 2026-05-26T00:46:29.4516795Z [2m-[22m core
ci Format check (affected) 2026-05-26T00:46:29.4517174Z [2m-[22m telemetry
ci Format check (affected) 2026-05-26T00:46:29.4517602Z [2m-[22m events
ci Format check (affected) 2026-05-26T00:46:29.4517985Z [2m-[22m cli-args
ci Format check (affected) 2026-05-26T00:46:29.4518359Z [2m-[22m workflow
ci Format check (affected) 2026-05-26T00:46:29.4518674Z [2m-[22m content
ci Format check (affected) 2026-05-26T00:46:29.4518994Z [2m-[22m context
ci Format check (affected) 2026-05-26T00:46:29.4519328Z [2m-[22m version
ci Format check (affected) 2026-05-26T00:46:29.4519643Z [2m-[22m output
ci Format check (affected) 2026-05-26T00:46:29.4519961Z [2m-[22m paths
ci Format check (affected) 2026-05-26T00:46:29.4520269Z [2m-[22m types
ci Format check (affected) 2026-05-26T00:46:29.4520578Z [2m-[22m log
ci Format check (affected) 2026-05-26T00:46:29.4520738Z
ci Format check (affected) 2026-05-26T00:46:29.4520925Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-26T00:46:29.6418612Z
ci Format check (affected) 2026-05-26T00:46:29.6420643Z ##[group]✅ [2m> [22m[2mnx run[22m types:"fmt:check"
ci Format check (affected) 2026-05-26T00:46:29.6421288Z
ci Format check (affected) 2026-05-26T00:46:29.6421907Z [2m> [22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-26T00:46:29.6422723Z
ci Format check (affected) 2026-05-26T00:46:29.6423084Z Checking formatting...
ci Format check (affected) 2026-05-26T00:46:29.6423510Z
ci Format check (affected) 20
…[truncated 428993 chars]

--- run 26425934416 ---
check-sync Verify ci-local.sh mirrors every ci.yml step ﻿2026-05-26T00:46:20.4976058Z ##[group]Run bun scripts/check-ci-local-sync.ts
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.4976511Z [36;1mbun scripts/check-ci-local-sync.ts[0m
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5002974Z shell: /usr/bin/bash -e {0}
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5003263Z ##[endgroup]
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5286014Z ci-local.sh is missing run_step entries for the following ci.yml steps:
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5287159Z
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5287842Z - "No duplicate declarations"
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5288231Z
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5288490Z Either add a matching run_step in scripts/ci-local.sh or mark the
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5288973Z step with `# local-ci: skip` in .github/workflows/ci.yml if it
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5289523Z intentionally has no local equivalent.
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-26T00:46:20.5312884Z ##[error]Process completed with exit code 1.

```

```
