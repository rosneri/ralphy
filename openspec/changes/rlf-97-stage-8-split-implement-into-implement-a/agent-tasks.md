## Fix failing CI checks (2026-05-21T09:17:02.717Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26216949522 ---
ci Architecture doc drift check ﻿2026-05-21T09:15:40.8209173Z ##[group]Run bun run build:architecture
ci Architecture doc drift check 2026-05-21T09:15:40.8209573Z [36;1mbun run build:architecture[0m
ci Architecture doc drift check 2026-05-21T09:15:40.8209919Z [36;1mgit diff --exit-code ARCHITECTURE.md[0m
ci Architecture doc drift check 2026-05-21T09:15:40.8246927Z shell: /usr/bin/bash -e {0}
ci Architecture doc drift check 2026-05-21T09:15:40.8247253Z env:
ci Architecture doc drift check 2026-05-21T09:15:40.8247604Z NX_BASE: 9d140358e93f4827e4c19fc3a759eac55ca7e4d0
ci Architecture doc drift check 2026-05-21T09:15:40.8248116Z NX_HEAD: 8dbb3ac37f636cb5d47282da00b35a240a7c44b5
ci Architecture doc drift check 2026-05-21T09:15:40.8248454Z ##[endgroup]
ci Architecture doc drift check 2026-05-21T09:15:40.8326379Z $ bun run apps/agent/src/scripts/generate-architecture.ts
ci Architecture doc drift check 2026-05-21T09:15:40.8508934Z wrote /home/runner/work/ralphy/ralphy/ARCHITECTURE.md
ci Architecture doc drift check 2026-05-21T09:15:40.8556240Z diff --git a/ARCHITECTURE.md b/ARCHITECTURE.md
ci Architecture doc drift check 2026-05-21T09:15:40.8557013Z index c0a2c91..921d242 100644
ci Architecture doc drift check 2026-05-21T09:15:40.8557336Z --- a/ARCHITECTURE.md
ci Architecture doc drift check 2026-05-21T09:15:40.8557623Z +++ b/ARCHITECTURE.md
ci Architecture doc drift check 2026-05-21T09:15:40.8558105Z @@ -25,6 +25,12 @@ This document is generated from the static feature registry
ci Architecture doc drift check 2026-05-21T09:15:40.8558652Z - **ownedSlot**: `ci`
ci Architecture doc drift check 2026-05-21T09:15:40.8559541Z - **summary**: Detects PRs whose CI checks have failed and dispatches a worker to fix the failures.
ci Architecture doc drift check 2026-05-21T09:15:40.8560345Z  
ci Architecture doc drift check 2026-05-21T09:15:40.8560968Z +### awaiting-ci
ci Architecture doc drift check 2026-05-21T09:15:40.8561329Z +
ci Architecture doc drift check 2026-05-21T09:15:40.8561659Z +- **id**: `awaiting-ci`
ci Architecture doc drift check 2026-05-21T09:15:40.8562082Z +- **ownedSlot**: `(none)`
ci Architecture doc drift check 2026-05-21T09:15:40.8562471Z +- **summary**: (no summary)
ci Architecture doc drift check 2026-05-21T09:15:40.8562749Z +
ci Architecture doc drift check 2026-05-21T09:15:40.8562983Z ### implement
ci Architecture doc drift check 2026-05-21T09:15:40.8563217Z  
ci Architecture doc drift check 2026-05-21T09:15:40.8563434Z - **id**: `implement`
ci Architecture doc drift check 2026-05-21T09:15:40.8563903Z @@ -66,13 +72,15 @@ The final row is the `idle` catch-all so the router is total.
ci Architecture doc drift check 2026-05-21T09:15:40.8564668Z | 2 | awaiting → confirm | `confirmation` |
ci Architecture doc drift check 2026-05-21T09:15:40.8565081Z | 3 | pr conflicting | `conflict-fix` |
ci Architecture doc drift check 2026-05-21T09:15:40.8565481Z | 4 | pr ci failing | `ci-fix` |
ci Architecture doc drift check 2026-05-21T09:15:40.8565888Z -| 5 | review bucket | `review-followup` |
ci Architecture doc drift check 2026-05-21T09:15:40.8566311Z -| 6 | stuck | `stuck` |
ci Architecture doc drift check 2026-05-21T09:15:40.8566909Z -| 7 | new ticket | `new-ticket` |
ci Architecture doc drift check 2026-05-21T09:15:40.8567321Z -| 8 | mention catch-all | `mention` |
ci Architecture doc drift check 2026-05-21T09:15:40.8567753Z -| 9 | in-progress implement | `implement` |
ci Architecture doc drift check 2026-05-21T09:15:40.8568157Z -| 10 | todo implement | `implement` |
ci Architecture doc drift check 2026-05-21T09:15:40.8568550Z -| 11 | idle catch-all | `idle` |
ci Architecture doc drift check 2026-05-21T09:15:40.8568949Z +| 5 | awaiting-ci pass | `awaiting-ci` |
ci Architecture doc drift check 2026-05-21T09:15:40.8569347Z +| 6 | awaiting-ci watch | `awai
…[truncated 268490 chars]

```

```
