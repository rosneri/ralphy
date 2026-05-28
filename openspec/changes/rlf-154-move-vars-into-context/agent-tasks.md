## Fix failing CI checks (2026-05-28T11:16:12.260Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26571259241 ---
ci Format check (affected) ﻿2026-05-28T11:14:07.6306268Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-28T11:14:07.6306693Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-28T11:14:07.6336169Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-28T11:14:07.6336385Z env:
ci Format check (affected) 2026-05-28T11:14:07.6336580Z NX_BASE: 3109143db5d5456a63c3795dcee51e6c63773cee
ci Format check (affected) 2026-05-28T11:14:07.6336859Z NX_HEAD: 1fc9c6b48e2a1bcecd1702ecd3bc946662818a1f
ci Format check (affected) 2026-05-28T11:14:07.6337087Z ##[endgroup]
ci Format check (affected) 2026-05-28T11:14:07.6397572Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-28T11:14:07.8134710Z
ci Format check (affected) 2026-05-28T11:14:07.8138478Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1m3109143db5d5456a63c3795dcee51e6c63773cee[22m[39m
ci Format check (affected) 2026-05-28T11:14:07.8139521Z
ci Format check (affected) 2026-05-28T11:14:07.8139532Z
ci Format check (affected) 2026-05-28T11:14:07.8140917Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m1fc9c6b48e2a1bcecd1702ecd3bc946662818a1f[22m[39m
ci Format check (affected) 2026-05-28T11:14:07.8141981Z
ci Format check (affected) 2026-05-28T11:14:08.1855734Z
ci Format check (affected) 2026-05-28T11:14:08.1856871Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 10 projects:[39m
ci Format check (affected) 2026-05-28T11:14:08.1857228Z
ci Format check (affected) 2026-05-28T11:14:08.1857402Z [2m-[22m agent
ci Format check (affected) 2026-05-28T11:14:08.1857645Z [2m-[22m shell
ci Format check (affected) 2026-05-28T11:14:08.1857834Z [2m-[22m loop
ci Format check (affected) 2026-05-28T11:14:08.1858028Z [2m-[22m context
ci Format check (affected) 2026-05-28T11:14:08.1858220Z [2m-[22m core
ci Format check (affected) 2026-05-28T11:14:08.1858406Z [2m-[22m mcp
ci Format check (affected) 2026-05-28T11:14:08.1858581Z [2m-[22m types
ci Format check (affected) 2026-05-28T11:14:08.1858781Z [2m-[22m adapter-codex
ci Format check (affected) 2026-05-28T11:14:08.1859009Z [2m-[22m engine
ci Format check (affected) 2026-05-28T11:14:08.1859204Z [2m-[22m cli-args
ci Format check (affected) 2026-05-28T11:14:08.1859313Z
ci Format check (affected) 2026-05-28T11:14:08.1859409Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-28T11:14:08.3608736Z
ci Format check (affected) 2026-05-28T11:14:08.3610410Z ##[group]✅ [2m> [22m[2mnx run[22m context:"fmt:check"
ci Format check (affected) 2026-05-28T11:14:08.3610808Z
ci Format check (affected) 2026-05-28T11:14:08.3611283Z [2m> [22moxfmt --check packages/context/src
ci Format check (affected) 2026-05-28T11:14:08.3611575Z
ci Format check (affected) 2026-05-28T11:14:08.3611836Z Checking formatting...
ci Format check (affected) 2026-05-28T11:14:08.3612043Z
ci Format check (affected) 2026-05-28T11:14:08.3612293Z All matched files use the correct format.
ci Format check (affected) 2026-05-28T11:14:08.3612822Z Finished in 44ms on 2 files using 4 threads.
ci Format check (affected) 2026-05-28T11:14:08.3646871Z ##[endgroup]
ci Format check (affected) 2026-05-28T11:14:08.3647888Z ##[group]✅ [2m> [22m[2mnx run[22m types:"fmt:check"
ci Format check (affected) 2026-05-28T11:14:08.3648488Z
ci Format check (affected) 2026-05-28T11:14:08.3649047Z [2m> [22moxfmt --check packages/types/src
ci Format check (affected) 2026-05-28T11:14:08.3649513Z
ci Format check (affected) 2026-05-28T11:14:08.3649824Z Checking formatting...
ci Format check (affected) 2026-05-28T11:14:08.3650179Z
ci Format check (affected) 2026-05-28T11:14:08.3650550Z All matched files use the correct format.
ci Format check (affected) 202
…[truncated 274477 chars]

```

```
