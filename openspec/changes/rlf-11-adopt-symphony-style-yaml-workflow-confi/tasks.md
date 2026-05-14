# Tasks for RLF-11

## Fix failing CI checks (2026-05-14T19:56:10.262Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25882149387 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-14T19:54:22.5331527Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5331933Z [36;1mbun scripts/check-static-error-messages.ts[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5353587Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5353833Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5354059Z NX_BASE: 5392d01e0d9f47569bc39526dcb89e222ead3d49
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5354381Z NX_HEAD: 1d9eabce4a945928d7a42773db3ffc83770f99dc
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5354651Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5805986Z ✘ Found 2 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5806579Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5806952Z packages/workflow/src/template.ts:151
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5807596Z if (!m) throw new Error(`Bad for-tag: {% ${inner} %}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5808012Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5810611Z packages/workflow/src/template.ts:156
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5811206Z throw new Error(`Unknown tag: {% ${inner} %}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5811559Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5812093Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5813239Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T19:54:22.5843890Z ##[error]Process completed with exit code 1.
ci Spell check ﻿2026-05-14T19:54:54.2131849Z ##[group]Run bunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress
ci Spell check 2026-05-14T19:54:54.2143596Z [36;1mbunx cspell "**/\*.{ts,tsx,js,mjs,mts,json,md}" --no-progress[0m
ci Spell check 2026-05-14T19:54:54.2166510Z shell: /usr/bin/bash -e {0}
ci Spell check 2026-05-14T19:54:54.2166765Z env:
ci Spell check 2026-05-14T19:54:54.2167013Z NX_BASE: 5392d01e0d9f47569bc39526dcb89e222ead3d49
ci Spell check 2026-05-14T19:54:54.2167339Z NX_HEAD: 1d9eabce4a945928d7a42773db3ffc83770f99dc
ci Spell check 2026-05-14T19:54:54.2167622Z ##[endgroup]
ci Spell check 2026-05-14T19:54:54.2268015Z Resolving dependencies
ci Spell check 2026-05-14T19:54:54.7683471Z Resolved, downloaded and extracted [216]
ci Spell check 2026-05-14T19:54:54.7962518Z Saved lockfile
ci Spell check 2026-05-14T19:54:57.1112192Z packages/workflow/src/workflow.ts:165:14 - Unknown word (scaffolder)
ci Spell check 2026-05-14T19:54:57.1958659Z WORKFLOW.md:167:4 - Unknown word (endfor)
ci Spell check 2026-05-14T19:54:57.1961860Z CSpell: Files checked: 253, Issues found: 2 in 2 files.
ci Spell check 2026-05-14T19:54:57.2221437Z ##[error]Process completed with exit code 1.
ci Unused dependency check ﻿2026-05-14T19:54:58.5700561Z ##[group]Run bun run check:unused:ci
ci Unused
…[truncated 73993 chars]

```

```

## Subtasks

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-11/adopt-symphony-style-yaml-workflow-config-workflowmd-frontmatter and break it into concrete subtasks
- [x] Implement the changes described in proposal.md
- [x] Add or update tests covering the new behavior
- [x] Run `bun run lint` and `bun run test` and fix any failures
