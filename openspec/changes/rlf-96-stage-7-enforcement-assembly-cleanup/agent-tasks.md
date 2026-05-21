## Fix failing CI checks (2026-05-21T07:43:05.358Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26212513574 ---
ci Typecheck (affected) ﻿2026-05-21T07:41:08.5011249Z ##[group]Run bun run typecheck:ci
ci Typecheck (affected) 2026-05-21T07:41:08.5011766Z [36;1mbun run typecheck:ci[0m
ci Typecheck (affected) 2026-05-21T07:41:08.5045522Z shell: /usr/bin/bash -e {0}
ci Typecheck (affected) 2026-05-21T07:41:08.5045883Z env:
ci Typecheck (affected) 2026-05-21T07:41:08.5046296Z NX_BASE: e7219a1d543c14416aa8c951eecfed3df541a144
ci Typecheck (affected) 2026-05-21T07:41:08.5046786Z NX_HEAD: be013ccee0c70b99caf498c4e1f00fdf2206f76a
ci Typecheck (affected) 2026-05-21T07:41:08.5047270Z NODE_OPTIONS: --max-old-space-size=8192
ci Typecheck (affected) 2026-05-21T07:41:08.5047699Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T07:41:08.5123125Z $ nx affected -t typecheck --parallel=1 --exclude=ui
ci Typecheck (affected) 2026-05-21T07:41:08.7698398Z
ci Typecheck (affected) 2026-05-21T07:41:08.7704009Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1me7219a1d543c14416aa8c951eecfed3df541a144[22m[39m
ci Typecheck (affected) 2026-05-21T07:41:08.7705838Z
ci Typecheck (affected) 2026-05-21T07:41:08.7705853Z
ci Typecheck (affected) 2026-05-21T07:41:08.7707461Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1mbe013ccee0c70b99caf498c4e1f00fdf2206f76a[22m[39m
ci Typecheck (affected) 2026-05-21T07:41:08.7709192Z
ci Typecheck (affected) 2026-05-21T07:41:09.1943852Z
ci Typecheck (affected) 2026-05-21T07:41:09.1945869Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mtypecheck[22m for 4 projects and [1m15[22m tasks they depend on:[39m
ci Typecheck (affected) 2026-05-21T07:41:09.1947236Z
ci Typecheck (affected) 2026-05-21T07:41:09.1947541Z [2m-[22m agent
ci Typecheck (affected) 2026-05-21T07:41:09.1948707Z [2m-[22m shell
ci Typecheck (affected) 2026-05-21T07:41:09.1949414Z [2m-[22m loop
ci Typecheck (affected) 2026-05-21T07:41:09.1950201Z [2m-[22m events
ci Typecheck (affected) 2026-05-21T07:41:09.1950551Z
ci Typecheck (affected) 2026-05-21T07:41:09.1950847Z [2m[36m[39m[22m
ci Typecheck (affected) 2026-05-21T07:41:11.1892947Z
ci Typecheck (affected) 2026-05-21T07:41:11.1894361Z ##[group]✅ [2m> [22m[2mnx run[22m types:typecheck
ci Typecheck (affected) 2026-05-21T07:41:11.1894842Z
ci Typecheck (affected) 2026-05-21T07:41:11.1895258Z [2m> [22mtsc -b packages/types/tsconfig.json
ci Typecheck (affected) 2026-05-21T07:41:11.1895560Z
ci Typecheck (affected) 2026-05-21T07:41:12.2567410Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T07:41:12.2569167Z ##[group]✅ [2m> [22m[2mnx run[22m version:typecheck
ci Typecheck (affected) 2026-05-21T07:41:12.2569851Z
ci Typecheck (affected) 2026-05-21T07:41:12.2570420Z [2m> [22mtsc -b packages/version/tsconfig.json
ci Typecheck (affected) 2026-05-21T07:41:12.2570911Z
ci Typecheck (affected) 2026-05-21T07:41:13.4748572Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T07:41:13.4749821Z ##[group]✅ [2m> [22m[2mnx run[22m telemetry:typecheck
ci Typecheck (affected) 2026-05-21T07:41:13.4750377Z
ci Typecheck (affected) 2026-05-21T07:41:13.4751031Z [2m> [22mtsc -b packages/telemetry/tsconfig.json
ci Typecheck (affected) 2026-05-21T07:41:13.4751479Z
ci Typecheck (affected) 2026-05-21T07:41:14.6944765Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T07:41:14.6946110Z ##[group]✅ [2m> [22m[2mnx run[22m output:typecheck
ci Typecheck (affected) 2026-05-21T07:41:14.6946617Z
ci Typecheck (affected) 2026-05-21T07:41:14.6947260Z [2m> [22mtsc -b packages/output/tsconfig.json
ci Typecheck (affected) 2026-05-21T07:41:14.6947691Z
ci Typecheck (affected) 2026-05-21T07:41:15.9359319Z ##[endgroup]
ci Typecheck (affected) 2026-05-21T07:41:15.9360292Z ##[group]✅ [2m> [22m[2mnx run[22m context:typecheck
ci Typecheck (affected) 2026-05-21T07:41:
…[truncated 198987 chars]

```

```

## Fix failing CI checks (2026-05-21T07:28:02.076Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26211837583 ---
ci Folder size check ﻿2026-05-21T07:25:57.1572990Z ##[group]Run bun scripts/check-folder-size.ts
ci Folder size check 2026-05-21T07:25:57.1573375Z [36;1mbun scripts/check-folder-size.ts[0m
ci Folder size check 2026-05-21T07:25:57.1605341Z shell: /usr/bin/bash -e {0}
ci Folder size check 2026-05-21T07:25:57.1605589Z env:
ci Folder size check 2026-05-21T07:25:57.1605822Z NX_BASE: e7219a1d543c14416aa8c951eecfed3df541a144
ci Folder size check 2026-05-21T07:25:57.1606179Z NX_HEAD: 13d2cb058eaf80a6e1d028c6caab758d5ebe6636
ci Folder size check 2026-05-21T07:25:57.1606488Z ##[endgroup]
ci Folder size check 2026-05-21T07:25:57.1969783Z ✘ Found 1 directory(s) with more than 10 source files:
ci Folder size check 2026-05-21T07:25:57.1970270Z
ci Folder size check 2026-05-21T07:25:57.1970495Z apps/agent/src/agent/ (22 files)
ci Folder size check 2026-05-21T07:25:57.1971216Z wire-spawn.ts
ci Folder size check 2026-05-21T07:25:57.1971585Z wire-baseline.ts
ci Folder size check 2026-05-21T07:25:57.1971959Z wire-prepare.ts
ci Folder size check 2026-05-21T07:25:57.1972317Z post-task.ts
ci Folder size check 2026-05-21T07:25:57.1972653Z wire.ts
ci Folder size check 2026-05-21T07:25:57.1972980Z wire-task-bodies.ts
ci Folder size check 2026-05-21T07:25:57.1973374Z json-runner.ts
ci Folder size check 2026-05-21T07:25:57.1973716Z worktree.ts
ci Folder size check 2026-05-21T07:25:57.1974050Z wire-runners.ts
ci Folder size check 2026-05-21T07:25:57.1974450Z scaffold.ts
ci Folder size check 2026-05-21T07:25:57.1974770Z config.ts
ci Folder size check 2026-05-21T07:25:57.1975207Z wire-mention-scan.ts
ci Folder size check 2026-05-21T07:25:57.1975612Z wire-pr-helpers.ts
ci Folder size check 2026-05-21T07:25:57.1976005Z wire-spawn-worker.ts
ci Folder size check 2026-05-21T07:25:57.1976398Z wire-indicators.ts
ci Folder size check 2026-05-21T07:25:57.1976769Z coordinator.ts
ci Folder size check 2026-05-21T07:25:57.1977158Z wire-linear-resolvers.ts
ci Folder size check 2026-05-21T07:25:57.1977568Z linear.ts
ci Folder size check 2026-05-21T07:25:57.1977901Z wire-comment-sync.ts
ci Folder size check 2026-05-21T07:25:57.1978303Z wire-pr-discovery.ts
ci Folder size check 2026-05-21T07:25:57.1978568Z
ci Folder size check 2026-05-21T07:25:57.1978708Z pr.ts
ci Folder size check 2026-05-21T07:25:57.1979012Z ci.ts
ci Folder size check 2026-05-21T07:25:57.1979757Z Split large directories into sub-features or move shared utilities to a library.
ci Folder size check 2026-05-21T07:25:57.2004540Z ##[error]Process completed with exit code 1.
ci No unsafe casts (as any / as unknown) ﻿2026-05-21T07:25:57.3157011Z ##[group]Run bash scripts/check-no-unsafe-casts.sh
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3157437Z [36;1mbash scripts/check-no-unsafe-casts.sh[0m
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3193638Z shell: /usr/bin/bash -e {0}
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3193889Z env:
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3194120Z NX_BASE: e7219a1d543c14416aa8c951eecfed3df541a144
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3194463Z NX_HEAD: 13d2cb058eaf80a6e1d028c6caab758d5ebe6636
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3194751Z ##[endgroup]
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3440568Z ✘ Found 2 unsafe cast(s):
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3441149Z
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3441838Z apps/agent/src/features/**tests**/registry-disable.test.ts:40: gh: null as unknown,
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3442952Z apps/agent/src/features/**tests**/registry-disable.test.ts:73: linear: null as unknown,
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3443332Z
ci No unsafe casts (as any / as unknown) 2026-05-21T07:25:57.3443
…[truncated 208474 chars]

--- run 26211837496 ---
check-sync Verify ci-local.sh mirrors every ci.yml step ﻿2026-05-21T07:25:49.0762565Z ##[group]Run bun scripts/check-ci-local-sync.ts
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.0763071Z [36;1mbun scripts/check-ci-local-sync.ts[0m
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.0804734Z shell: /usr/bin/bash -e {0}
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.0805087Z ##[endgroup]
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1117366Z ci-local.sh is missing run_step entries for the following ci.yml steps:
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1118294Z
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1118534Z - "Architecture doc drift check"
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1118892Z
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1119242Z Either add a matching run_step in scripts/ci-local.sh or mark the
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1120108Z step with `# local-ci: skip` in .github/workflows/ci.yml if it
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1120650Z intentionally has no local equivalent.
check-sync Verify ci-local.sh mirrors every ci.yml step 2026-05-21T07:25:49.1150258Z ##[error]Process completed with exit code 1.

```

```
