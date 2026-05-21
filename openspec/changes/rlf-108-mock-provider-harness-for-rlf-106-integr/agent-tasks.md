## Resolve PR merge conflicts (2026-05-21T21:11:50.501Z)

- [x] Resolve PR merge conflicts. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR https://github.com/NeriRos/ralphy/pull/250 has merge conflicts with `main`.

Steps:
1. `git fetch origin main` then rebase or merge `main` into the current branch.
2. Resolve conflicts in the files git lists.
3. Stage and commit the resolution.
```

## Fix failing CI checks (2026-05-21T13:34:15.642Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26229196203 ---
ci Static error messages (no template literals in Error/Exception constructors) ﻿2026-05-21T13:32:23.1643425Z ##[group]Run bun scripts/check-static-error-messages.ts
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1643913Z ^[[36;1mbun scripts/check-static-error-messages.ts^[[0m
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1679607Z shell: /usr/bin/bash -e {0}
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1679919Z env:
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1680200Z NX_BASE: 6666ce7ac36302a176317ecee5c57b94bb7616f9
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1680590Z NX_HEAD: e25d8b96a310e562a32078ea347885dc7f9fdd86
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.1681142Z ##[endgroup]
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2403528Z ✘ Found 5 error constructor(s) with dynamic message(s):
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2403923Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2404144Z apps/agent/test/harness/scripted-engine.ts:23
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2404662Z throw new Error(`scripted-engine: missing step at ${i - 1}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2404962Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2405135Z apps/agent/test/harness/fake-linear.ts:170
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2405598Z if (!cur) throw new Error(`fake-linear: unknown issue ${id}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2405929Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2406094Z apps/agent/test/harness/fake-linear.ts:175
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2406562Z if (!cur) throw new Error(`fake-linear: unknown issue ${id}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2406823Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2406975Z apps/agent/test/harness/fake-gh.ts:45
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2407509Z throw new Error(`scripted shim: only gh calls supported, got: ${argv.join(" ")}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2407871Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2408033Z apps/agent/test/harness/tmp-repo.ts:31
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2408486Z throw new Error(`git ${args.join(" ")} failed (${code}): ${stderr}`);
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2408780Z
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2409126Z Error messages must be static strings so they are searchable in logs and monitoring.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05-21T13:32:23.2409828Z Move dynamic values into a separate field (e.g. context object) rather than the message.
ci Static error messages (no template literals in Error/Exception constructors) 2026-05
…[truncated 306168 chars]

```

```

## Manual Testing

- [x] Run `bun run test:affected-files:coverage:ci` from repo root and confirm exit code 0 (coverage gate restored after fake-linear / scenarios tests added).
- [x] Run `bun scripts/check-static-error-messages.ts` and confirm "All error constructors use static messages" (covers scenarios/index.ts dynamic-message fix).
- [x] Run `bun test test/harness/__tests__/fake-linear.test.ts` from `apps/agent` and confirm the new setError/setConflicted/project/clearReview/setLabels/setStatus/pushComment cases pass.
- [x] Run `bun test test/harness/__tests__/scenarios.test.ts` and confirm `getScenario` happy path + unknown-scenario error (with `cause` carrying name + registered list) both pass.
- [x] Inspect `apps/agent/test/harness/scenarios/index.ts:11-13` and confirm the Error message is a static string with dynamic context moved to `cause`.
- [x] Run `bunx nx run agent:typecheck` and confirm it passes after narrowing the `registry["s1.1-fresh-todo"]` lookup in `scenarios.test.ts` (was failing under `noUncheckedIndexedAccess` because the indexed access yields `ScenarioDefinition | undefined`).
