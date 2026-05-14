## Fix failing CI checks (2026-05-14T18:00:36.463Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25876470051 ---
ci Format check (affected) ﻿2026-05-14T17:59:49.3845180Z ##[group]Run bun run fmt:ci
ci Format check (affected) 2026-05-14T17:59:49.3845511Z [36;1mbun run fmt:ci[0m
ci Format check (affected) 2026-05-14T17:59:49.3866624Z shell: /usr/bin/bash -e {0}
ci Format check (affected) 2026-05-14T17:59:49.3866880Z env:
ci Format check (affected) 2026-05-14T17:59:49.3867110Z NX_BASE: ba3ce3306a1881d4ae43a776ff7cb12db67d9a3c
ci Format check (affected) 2026-05-14T17:59:49.3867466Z NX_HEAD: da7ef2b073e8cd2e87dca5c82adc8c6923b03367
ci Format check (affected) 2026-05-14T17:59:49.3867769Z ##[endgroup]
ci Format check (affected) 2026-05-14T17:59:49.3931504Z $ nx affected -t fmt:check --exclude=ui
ci Format check (affected) 2026-05-14T17:59:49.6276344Z
ci Format check (affected) 2026-05-14T17:59:49.6281328Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --base argument provided, but found environment variable NX_BASE so using its value as the affected base: [1mba3ce3306a1881d4ae43a776ff7cb12db67d9a3c[22m[39m
ci Format check (affected) 2026-05-14T17:59:49.6282828Z
ci Format check (affected) 2026-05-14T17:59:49.6282844Z
ci Format check (affected) 2026-05-14T17:59:49.6285115Z [7m[1m[38;5;214m NX [39m[22m[27m [38;5;214mNo explicit --head argument provided, but found environment variable NX_HEAD so using its value as the affected head: [1mda7ef2b073e8cd2e87dca5c82adc8c6923b03367[22m[39m
ci Format check (affected) 2026-05-14T17:59:49.6286597Z
ci Format check (affected) 2026-05-14T17:59:49.9915970Z
ci Format check (affected) 2026-05-14T17:59:49.9917008Z [7m[1m[36m NX [39m[22m[27m [36mRunning target [1mfmt:check[22m for 4 projects:[39m
ci Format check (affected) 2026-05-14T17:59:49.9917399Z
ci Format check (affected) 2026-05-14T17:59:49.9917729Z [2m-[22m engine
ci Format check (affected) 2026-05-14T17:59:49.9918148Z [2m-[22m agent
ci Format check (affected) 2026-05-14T17:59:49.9918523Z [2m-[22m shell
ci Format check (affected) 2026-05-14T17:59:49.9918893Z [2m-[22m loop
ci Format check (affected) 2026-05-14T17:59:49.9919091Z
ci Format check (affected) 2026-05-14T17:59:49.9919237Z [2m[36m[39m[22m
ci Format check (affected) 2026-05-14T17:59:50.2369541Z
ci Format check (affected) 2026-05-14T17:59:50.2370863Z ##[group]✅ [2m> [22m[2mnx run[22m engine:"fmt:check"
ci Format check (affected) 2026-05-14T17:59:50.2371331Z
ci Format check (affected) 2026-05-14T17:59:50.2371770Z [2m> [22moxfmt --check packages/engine/src
ci Format check (affected) 2026-05-14T17:59:50.2372197Z
ci Format check (affected) 2026-05-14T17:59:50.2372408Z Checking formatting...
ci Format check (affected) 2026-05-14T17:59:50.2372671Z
ci Format check (affected) 2026-05-14T17:59:50.2373666Z All matched files use the correct format.
ci Format check (affected) 2026-05-14T17:59:50.2374389Z Finished in 85ms on 14 files using 4 threads.
ci Format check (affected) 2026-05-14T17:59:50.2515616Z ##[endgroup]
ci Format check (affected) 2026-05-14T17:59:50.2517232Z ##[group]❌ [2m> [22m[2mnx run[22m loop:"fmt:check"
ci Format check (affected) 2026-05-14T17:59:50.2518210Z
ci Format check (affected) 2026-05-14T17:59:50.2518827Z [2m> [22moxfmt --check apps/loop/src
ci Format check (affected) 2026-05-14T17:59:50.2519166Z
ci Format check (affected) 2026-05-14T17:59:50.2519367Z Checking formatting...
ci Format check (affected) 2026-05-14T17:59:50.2519908Z
ci Format check (affected) 2026-05-14T17:59:50.2520266Z apps/loop/src/**tests**/components.test.tsx (8ms)
ci Format check (affected) 2026-05-14T17:59:50.2520511Z
ci Format check (affected) 2026-05-14T17:59:50.2520809Z Format issues found in above 1 files. Run without `--check` to fix.
ci Format check (affected) 2026-05-14T17:59:50.2521326Z Finished in 116ms on 22 files using 4 threads.
ci Format check (affected) 2026-05-14T17:59:50.2551255Z Warning: command "oxfmt --check apps/loop/src" exited with non-zero status code::endgroup::
ci Format check (affected) 2026-05-14T17:59:50
…[truncated 83772 chars]

```

```

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
