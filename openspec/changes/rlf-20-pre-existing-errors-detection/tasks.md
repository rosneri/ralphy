## Fix failing CI checks (2026-05-15T07:03:49.627Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25905095058 ---
ci Format check (affected) ﻿2026-05-15T07:02:59.2612204Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-15T07:02:59.2612521Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-15T07:02:59.2634946Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-15T07:02:59.2635219Z env:
ci Format check (affected) 2026-05-15T07:02:59.2635479Z NX_BASE: c5a5c08381cce0a76a9e9979d4a9f7deebce38ca
ci Format check (affected) 2026-05-15T07:02:59.2635835Z NX_HEAD: 0610387cc3e1b31571baba70d7a0b04b10b0d833
ci Format check (affected) 2026-05-15T07:02:59.2636129Z ##[endgroup]
ci Format check (affected) 2026-05-15T07:02:59.2699615Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-15T07:02:59.5045475Z
ci Format check (affected) 2026-05-15T07:02:59.5049690Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mc5a5c08381cce0a76a9e9979d4a9f7deebce38ca[22m[39m
ci Format check (affected) 2026-05-15T07:02:59.5051016Z
ci Format check (affected) 2026-05-15T07:02:59.5051036Z
ci Format check (affected) 2026-05-15T07:02:59.5052534Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m0610387cc3e1b31571baba70d7a0b04b10b0d833[22m[39m
ci Format check (affected) 2026-05-15T07:02:59.5053312Z
ci Format check (affected) 2026-05-15T07:02:59.8618594Z
ci Format check (affected) 2026-05-15T07:02:59.8619705Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 4 projects:[39m
ci Format check (affected) 2026-05-15T07:02:59.8620096Z
ci Format check (affected) 2026-05-15T07:02:59.8620227Z [2m-[22m agent
ci Format check (affected) 2026-05-15T07:02:59.8620667Z [2m-[22m shell
ci Format check (affected) 2026-05-15T07:02:59.8621066Z [2m-[22m workflow
ci Format check (affected) 2026-05-15T07:02:59.8621640Z [2m-[22m loop
ci Format check (affected) 2026-05-15T07:02:59.8621853Z
ci Format check (affected) 2026-05-15T07:02:59.8622057Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-15T07:03:00.0946330Z
ci Format check (affected) 2026-05-15T07:03:00.0947828Z ##[group]✅ [2m> [22m[2mnx run[22m workflow:"fmt:check"
ci Format check (affected) 2026-05-15T07:03:00.0948298Z
ci Format check (affected) 2026-05-15T07:03:00.0948748Z [2m> [22moxfmt --check packages/workflow/src
ci Format check (affected) 2026-05-15T07:03:00.0949120Z
ci Format check (affected) 2026-05-15T07:03:00.0949320Z Checking formatting...
ci Format check (affected) 2026-05-15T07:03:00.0949570Z
ci Format check (affected) 2026-05-15T07:03:00.0949847Z All matched files use the correct format.
ci Format check (affected) 2026-05-15T07:03:00.0950445Z Finished in 84ms on 6 files using 4 threads.
ci Format check (affected) 2026-05-15T07:03:00.1000309Z ##[endgroup]
ci Format check (affected) 2026-05-15T07:03:00.1001189Z ##[group]❌ [2m> [22m[2mnx run[22m agent:"fmt:check"
ci Format check (affected) 2026-05-15T07:03:00.1001754Z
ci Format check (affected) 2026-05-15T07:03:00.1002109Z [2m> [22moxfmt --check apps/agent/src
ci Format check (affected) 2026-05-15T07:03:00.1002439Z
ci Format check (affected) 2026-05-15T07:03:00.1002616Z Checking formatting...
ci Format check (affected) 2026-05-15T07:03:00.1002861Z
ci Format check (affected) 2026-05-15T07:03:00.1003179Z apps/agent/src/components/AgentMode.tsx (12ms)
ci Format check (affected) 2026-05-15T07:03:00.1003663Z
ci Format check (affected) 2026-05-15T07:03:00.1004121Z Format issues found in above 1 files. Run without `--check` to fix.
ci Format check (affected) 2026-05-15T07:03:00.1004850Z Finished in 102ms on 32 files using 4 threads.
ci Format check (affected) 2026-05-15T07:03:00.1108200Z Warning: command "oxfmt --check apps/agent/src" exited with non-zero status code::endgroup::
ci Format check (affected) 2026-05-15T07:
…[truncated 94478 chars]

```

```

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
