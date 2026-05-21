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
