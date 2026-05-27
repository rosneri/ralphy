## Fix failing CI checks (2026-05-26T21:25:34.294Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26476000429 ---
ci Unused dependency check ﻿2026-05-26T21:25:04.0681986Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-26T21:25:04.0682330Z [36;1mbun run check:unused:ci[0m
ci Unused dependency check 2026-05-26T21:25:04.0718781Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-26T21:25:04.0719052Z env:
ci Unused dependency check 2026-05-26T21:25:04.0719294Z NX_BASE: 2f73550977cc380d16fbb753495049ecfb4ef2f3
ci Unused dependency check 2026-05-26T21:25:04.0719639Z NX_HEAD: 5ce42f4d7540a6c77139f32aaf92f6d889ac26c9
ci Unused dependency check 2026-05-26T21:25:04.0719932Z ##[endgroup]
ci Unused dependency check 2026-05-26T21:25:04.0798239Z $ knip
ci Unused dependency check 2026-05-26T21:25:08.0027968Z [93m[4mUnused exported types[24m[39m (3)
ci Unused dependency check 2026-05-26T21:25:08.0037944Z MergeabilityProbe interface apps/agent/src/shared/pr/wait-for-mergeability.ts:16:18
ci Unused dependency check 2026-05-26T21:25:08.0038714Z MergeabilityOutcome type apps/agent/src/shared/pr/wait-for-mergeability.ts:28:13
ci Unused dependency check 2026-05-26T21:25:08.0332969Z error: script "check:unused:ci" exited with code 1
ci Unused dependency check 2026-05-26T21:25:08.0333779Z WaitForMergeabilityOptions interface apps/agent/src/shared/pr/wait-for-mergeability.ts:42:18
ci Unused dependency check 2026-05-26T21:25:08.0344824Z ##[error]Process completed with exit code 1.

```

```
