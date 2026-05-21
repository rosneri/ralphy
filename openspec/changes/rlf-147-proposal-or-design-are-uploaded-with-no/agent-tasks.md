## Fix failing CI checks (2026-05-21T16:22:32.833Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26238613336 ---
ci Unused dependency check ﻿2026-05-21T16:21:13.8768781Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-21T16:21:13.8769133Z ^[[36;1mbun run check:unused:ci^[[0m
ci Unused dependency check 2026-05-21T16:21:13.8805704Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-21T16:21:13.8805982Z env:
ci Unused dependency check 2026-05-21T16:21:13.8806248Z NX_BASE: 66d894154d8e3b74fe2e143c691de51d308446b3
ci Unused dependency check 2026-05-21T16:21:13.8806590Z NX_HEAD: 2c3340ba43ed711fc8c8fa4732af0e2380444466
ci Unused dependency check 2026-05-21T16:21:13.8806877Z ##[endgroup]
ci Unused dependency check 2026-05-21T16:21:13.8887086Z $ knip
ci Unused dependency check 2026-05-21T16:21:17.7357186Z ^[[93m^[[4mUnused exports^[[24m^[[39m (1)
ci Unused dependency check 2026-05-21T16:21:17.7366163Z hasMeaningfulContent function apps/agent/src/agent/linear-sync/spec-attachments.ts:244:17
ci Unused dependency check 2026-05-21T16:21:17.7666345Z error: script "check:unused:ci" exited with code 1
ci Unused dependency check 2026-05-21T16:21:17.7677651Z ##[error]Process completed with exit code 1.

```

```
