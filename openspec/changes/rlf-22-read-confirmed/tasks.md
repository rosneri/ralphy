## Fix failing CI checks (2026-05-15T08:22:17.862Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 25907466277 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-15T08:10:04.8397113Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8397569Z [36;1mbun scripts/check-static-error-messages.ts[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8435077Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8435341Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8435591Z NX_BASE: fa8dba8f218b42f5523606ed23ae37815b714681
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8435937Z NX_HEAD: 6cc9441a00f15138ac09f26f0e5aeffcce7713e7
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8436224Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8915350Z ✘ Found 1 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8915822Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8916142Z apps/agent/src/**tests**/mention-reaction.test.ts:60
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8916796Z throw new Error(`unexpected fetch in test: ${url}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8917175Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8917705Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8918779Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-15T08:10:04.8962552Z ##[error]Process completed with exit code 1.

```

```
