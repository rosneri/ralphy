## Fix failing CI checks (2026-05-14T17:58:04.143Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25876337702 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-14T17:57:15.7079223Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7079673Z [36;1mbun scripts/check-static-error-messages.ts[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7114433Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7114683Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7114913Z NX_BASE: ba3ce3306a1881d4ae43a776ff7cb12db67d9a3c
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7115251Z NX_HEAD: 5740d5786968cb9c30c59d49b3e9dafdf02185ac
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7115557Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7598655Z ✘ Found 1 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7599543Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7623967Z packages/engine/src/agents/index.ts:16
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7634473Z throw new Error(`Unknown agent: ${name}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7634971Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7635734Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7637239Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-14T17:57:15.7648749Z ##[error]Process completed with exit code 1.
ci Format check (affected) ﻿2026-05-14T17:57:20.5652814Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-14T17:57:20.5653511Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-14T17:57:20.5689418Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-14T17:57:20.5689675Z env:
ci Format check (affected) 2026-05-14T17:57:20.5689903Z NX_BASE: ba3ce3306a1881d4ae43a776ff7cb12db67d9a3c
ci Format check (affected) 2026-05-14T17:57:20.5690237Z NX_HEAD: 5740d5786968cb9c30c59d49b3e9dafdf02185ac
ci Format check (affected) 2026-05-14T17:57:20.5690513Z ##[endgroup]
ci Format check (affected) 2026-05-14T17:57:20.5761639Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-14T17:57:20.8179851Z
ci Format check (affected) 2026-05-14T17:57:20.8185180Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mba3ce3306a1881d4ae43a776ff7cb12db67d9a3c[22m[39m
ci Format check (affected) 2026-05-14T17:57:20.8186224Z
ci Format check (affected) 2026-05-14T17:57:20.8186234Z
ci Format check (affected) 2026-05-14T17:57:20.8187611Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1m5740d5786968cb9c30c59d49b3e9dafdf02185ac[22m[39m
ci Format check (affected) 2026-05-14T17:57:20.8188609Z
ci Format check (affected) 2026-05-14T17:57:21.1781038Z
ci Format check (affected) 2026-05-14T17:57:21.1782235Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 4 projects:[39m
ci Format check (affected) 2026-05-14T17:57:21.1782
…[truncated 86119 chars]

```

```
