## Fix failing CI checks (2026-05-15T07:00:23.147Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25904960724 ---
ci Folder size check ﻿2026-05-15T06:59:16.6276278Z ##[group]Run bun scripts/check-folder-size.ts
ci Folder size check 2026-05-15T06:59:16.6276646Z [36;1mbun scripts/check-folder-size.ts[0m
ci Folder size check 2026-05-15T06:59:16.6297148Z shell: /usr/bin/bash -e {0}
ci Folder size check 2026-05-15T06:59:16.6297411Z env:
ci Folder size check 2026-05-15T06:59:16.6297641Z NX_BASE: c5a5c08381cce0a76a9e9979d4a9f7deebce38ca
ci Folder size check 2026-05-15T06:59:16.6297970Z NX_HEAD: 7856505d0c773232ada702bd5e2ef35a187b6dde
ci Folder size check 2026-05-15T06:59:16.6298248Z ##[endgroup]
ci Folder size check 2026-05-15T06:59:16.6575923Z ✘ Found 1 directory(s) with more than 10 source files:
ci Folder size check 2026-05-15T06:59:16.6576389Z
ci Folder size check 2026-05-15T06:59:16.6576435Z
ci Folder size check 2026-05-15T06:59:16.6578748Z apps/agent/src/agent/ (12 files)
ci Folder size check 2026-05-15T06:59:16.6579298Z baseline-gate.ts
ci Folder size check 2026-05-15T06:59:16.6579562Z post-task.ts
ci Folder size check 2026-05-15T06:59:16.6579763Z wire.ts
ci Folder size check 2026-05-15T06:59:16.6580176Z json-runner.ts
ci Folder size check 2026-05-15T06:59:16.6580394Z worktree.ts
ci Folder size check 2026-05-15T06:59:16.6580597Z scaffold.ts
ci Folder size check 2026-05-15T06:59:16.6580802Z config.ts
ci Folder size check 2026-05-15T06:59:16.6581196Z coordinator.ts
ci Folder size check 2026-05-15T06:59:16.6581402Z linear.ts
ci Folder size check 2026-05-15T06:59:16.6581655Z baseline.ts
ci Folder size check 2026-05-15T06:59:16.6581850Z pr.ts
ci Folder size check 2026-05-15T06:59:16.6582033Z ci.ts
ci Folder size check 2026-05-15T06:59:16.6582441Z Split large directories into sub-features or move shared utilities to a library.
ci Folder size check 2026-05-15T06:59:16.6602074Z ##[error]Process completed with exit code 1.
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-15T06:59:16.6955342Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6955758Z [36;1mbun scripts/check-static-error-messages.ts[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6976398Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6976671Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6976912Z NX_BASE: c5a5c08381cce0a76a9e9979d4a9f7deebce38ca
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6977244Z NX_HEAD: 7856505d0c773232ada702bd5e2ef35a187b6dde
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.6977525Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7393173Z ✘ Found 2 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7393707Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7394000Z apps/agent/src/**tests**/baseline.test.ts:33
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7394735Z const err = new Error(`exit ${entry.code}`) as Error & {
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7395169Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7395396Z apps/agent/src/agent/wire.ts:1635
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T06:59:16.7396128Z if (!teamId) throw new Error(`Linear team ${baselineTeam} not found`);
ci Static error messages (no template liter
…[truncated 99034 chars]

```

```
