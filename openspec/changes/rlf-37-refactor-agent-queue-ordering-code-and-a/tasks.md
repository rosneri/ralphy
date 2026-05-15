## Fix failing CI checks (2026-05-15T14:06:26.565Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25922172240 ---
ci Folder size check ﻿2026-05-15T14:05:38.5108138Z ##[group]Run bun scripts/check-folder-size.ts
ci Folder size check 2026-05-15T14:05:38.5108563Z [36;1mbun scripts/check-folder-size.ts[0m
ci Folder size check 2026-05-15T14:05:38.5146657Z shell: /usr/bin/bash -e {0}
ci Folder size check 2026-05-15T14:05:38.5146929Z env:
ci Folder size check 2026-05-15T14:05:38.5147169Z NX_BASE: 1b5c49329f6701d20edd71a95f934e783bdd38e9
ci Folder size check 2026-05-15T14:05:38.5147729Z NX_HEAD: 4f3358eba451895816a64f8ba5823e850a46875f
ci Folder size check 2026-05-15T14:05:38.5148011Z ##[endgroup]
ci Folder size check 2026-05-15T14:05:38.5485636Z ✘ Found 1 directory(s) with more than 10 source files:
ci Folder size check 2026-05-15T14:05:38.5486140Z
ci Folder size check 2026-05-15T14:05:38.5486373Z apps/agent/src/agent/ (11 files)
ci Folder size check 2026-05-15T14:05:38.5486847Z post-task.ts
ci Folder size check 2026-05-15T14:05:38.5487190Z wire.ts
ci Folder size check 2026-05-15T14:05:38.5487512Z json-runner.ts
ci Folder size check 2026-05-15T14:05:38.5487864Z worktree.ts
ci Folder size check 2026-05-15T14:05:38.5488198Z scaffold.ts
ci Folder size check 2026-05-15T14:05:38.5488524Z config.ts
ci Folder size check 2026-05-15T14:05:38.5488872Z coordinator.ts
ci Folder size check 2026-05-15T14:05:38.5489223Z linear.ts
ci Folder size check 2026-05-15T14:05:38.5489557Z queue-order.ts
ci Folder size check 2026-05-15T14:05:38.5489951Z pr.ts
ci Folder size check 2026-05-15T14:05:38.5490249Z ci.ts
ci Folder size check 2026-05-15T14:05:38.5490997Z Split large directories into sub-features or move shared utilities to a library.
ci Folder size check 2026-05-15T14:05:38.5491605Z
ci Folder size check 2026-05-15T14:05:38.5519815Z ##[error]Process completed with exit code 1.
ci Spell check ﻿2026-05-15T14:06:07.1895026Z ##[group]Run bunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress
ci Spell check 2026-05-15T14:06:07.1896207Z [36;1mbunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress[0m
ci Spell check 2026-05-15T14:06:07.1932830Z shell: /usr/bin/bash -e {0}
ci Spell check 2026-05-15T14:06:07.1933267Z env:
ci Spell check 2026-05-15T14:06:07.1933668Z NX_BASE: 1b5c49329f6701d20edd71a95f934e783bdd38e9
ci Spell check 2026-05-15T14:06:07.1934196Z NX_HEAD: 4f3358eba451895816a64f8ba5823e850a46875f
ci Spell check 2026-05-15T14:06:07.1934508Z ##[endgroup]
ci Spell check 2026-05-15T14:06:07.2043487Z Resolving dependencies
ci Spell check 2026-05-15T14:06:07.5348326Z Resolved, downloaded and extracted [216]
ci Spell check 2026-05-15T14:06:07.5624434Z Saved lockfile
ci Spell check 2026-05-15T14:06:09.3666605Z apps/agent/src/sort/compare.ts:5:29 - Unknown word (cmps)
ci Spell check 2026-05-15T14:06:09.3668161Z apps/agent/src/sort/compare.ts:7:21 - Unknown word (cmps)
ci Spell check 2026-05-15T14:06:10.2508870Z CSpell: Files checked: 279, Issues found: 2 in 1 file.
ci Spell check 2026-05-15T14:06:10.2787912Z ##[error]Process completed with exit code 1.

```

```
