## Fix failing CI checks (2026-05-14T19:28:19.680Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25880775467 ---
ci Spell check ﻿2026-05-14T19:27:04.1170010Z ##[group]Run bunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress
ci Spell check 2026-05-14T19:27:04.1170855Z [36;1mbunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress[0m
ci Spell check 2026-05-14T19:27:04.1204125Z shell: /usr/bin/bash -e {0}
ci Spell check 2026-05-14T19:27:04.1204369Z env:
ci Spell check 2026-05-14T19:27:04.1204595Z NX_BASE: 4abaa5d9e14102536a718547ea0c01c74be18948
ci Spell check 2026-05-14T19:27:04.1204928Z NX_HEAD: 8f3d287d14fc0885200ace1d4d42ab393489597d
ci Spell check 2026-05-14T19:27:04.1205209Z ##[endgroup]
ci Spell check 2026-05-14T19:27:04.1316432Z Resolving dependencies
ci Spell check 2026-05-14T19:27:04.7227431Z Resolved, downloaded and extracted [216]
ci Spell check 2026-05-14T19:27:04.7506373Z Saved lockfile
ci Spell check 2026-05-14T19:27:06.1806823Z apps/agent/src/**tests**/post-task.test.ts:801:27 - Unknown word (optout)
ci Spell check 2026-05-14T19:27:06.3042945Z apps/agent/src/agent/post-task.ts:128:66 - Unknown word (unparseable)
ci Spell check 2026-05-14T19:27:07.2911180Z CSpell: Files checked: 244, Issues found: 2 in 2 files.
ci Spell check 2026-05-14T19:27:07.3194996Z ##[error]Process completed with exit code 1.

```

```
