## Fix failing CI checks (2026-05-21T01:00:45.927Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26198992735 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-21T00:58:40.2420400Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2420888Z [36;1mbun scripts/check-static-error-messages.ts[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2456708Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2456988Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2457240Z NX_BASE: 562ff5a3e62ccd8b7251a31363f1fd0f75a28ab7
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2457591Z NX_HEAD: e3eceb98d6fb6a9023e8ba4d0b178126acf257c5
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.2457885Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3137278Z ✘ Found 2 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3137858Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3138494Z apps/agent/src/shared/capabilities/**tests**/run-capability.test.ts:39
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3139058Z if (attempts < 3) throw new Error(`transient ${attempts}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3139336Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3140456Z apps/agent/src/shared/capabilities/**tests**/linear-client.test.ts:21
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3141297Z if (!r) throw new Error(`unexpected extra fetch call (#${i})`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3141590Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3141990Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3142675Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T00:58:40.3187561Z ##[error]Process completed with exit code 1.
ci No unsafe casts (as any / as unknown) ﻿2026-05-21T00:58:40.3234976Z ##[group]Run bash scripts/check-no-unsafe-casts.sh
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3235433Z [36;1mbash scripts/check-no-unsafe-casts.sh[0m
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3271479Z shell: /usr/bin/bash -e {0}
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3271763Z env:
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3272017Z NX_BASE: 562ff5a3e62ccd8b7251a31363f1fd0f75a28ab7
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3272373Z NX_HEAD: e3eceb98d6fb6a9023e8ba4d0b178126acf257c5
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3272672Z ##[endgroup]
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3523193Z ✘ Found 2 unsafe cast(s):
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3523543Z
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3524676Z apps/agent/src/shared/capabilities/**tests**/gh-client.test.ts:67: if (e.type === "gh.cmd.failed") failed.push((e as unknown as { error: string }).error);
ci No unsafe casts (as any / as unknown) 2026-05-21T00:58:40.3526558Z apps/agent/src
…[truncated 228805 chars]

```

```
