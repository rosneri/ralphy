## Fix failing CI checks (2026-05-21T01:30:55.561Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26199969889 ---
ci Test affected files + coverage ﻿2026-05-21T01:29:40.0385732Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-21T01:29:40.0386113Z [36;1mbun run test:affected-files:coverage:ci[0m
ci Test affected files + coverage 2026-05-21T01:29:40.0406201Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-21T01:29:40.0406470Z env:
ci Test affected files + coverage 2026-05-21T01:29:40.0406696Z NX_BASE: 562ff5a3e62ccd8b7251a31363f1fd0f75a28ab7
ci Test affected files + coverage 2026-05-21T01:29:40.0407160Z NX_HEAD: 38c629fe2095d5a2b275a7b8d555676bae3d8d1b
ci Test affected files + coverage 2026-05-21T01:29:40.0407438Z ##[endgroup]
ci Test affected files + coverage 2026-05-21T01:29:40.0464676Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-21T01:29:40.0688425Z Detecting affected projects...
ci Test affected files + coverage 2026-05-21T01:29:40.0688747Z
ci Test affected files + coverage 2026-05-21T01:29:41.9734595Z agent: 15 relevant test file(s)
ci Test affected files + coverage 2026-05-21T01:29:41.9735245Z apps/agent/src/**tests**/agent-mode-chip.test.tsx
ci Test affected files + coverage 2026-05-21T01:29:41.9735791Z apps/agent/src/**tests**/agent-mode-show-all.test.tsx
ci Test affected files + coverage 2026-05-21T01:29:41.9736393Z apps/agent/src/**tests**/agent-mode-steering.test.tsx
ci Test affected files + coverage 2026-05-21T01:29:41.9737090Z apps/agent/src/**tests**/coordinator-restart-worker.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9737830Z apps/agent/src/**tests**/coordinator.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9738333Z apps/agent/src/**tests**/linear.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9738896Z apps/agent/src/**tests**/poll-context.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9739467Z apps/agent/src/**tests**/queue-order.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9740103Z apps/agent/src/**tests**/wire-setup-worktree.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9740800Z apps/agent/src/shared/capabilities/**tests**/fs-change.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9741627Z apps/agent/src/shared/capabilities/**tests**/gh-client.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9742321Z apps/agent/src/shared/capabilities/**tests**/git.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9743187Z apps/agent/src/shared/capabilities/**tests**/linear-client.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9743990Z apps/agent/src/shared/capabilities/**tests**/run-capability.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9744813Z apps/agent/src/shared/capabilities/**tests**/worker-spawner.test.ts
ci Test affected files + coverage 2026-05-21T01:29:41.9745256Z
ci Test affected files + coverage 2026-05-21T01:29:41.9750109Z bun test v1.3.14 (0d9b296a)
ci Test affected files + coverage 2026-05-21T01:29:41.9835118Z
ci Test affected files + coverage 2026-05-21T01:29:41.9836228Z ##[group]src/**tests**/awaiting-confirmation.test.ts:
ci Test affected files + coverage 2026-05-21T01:29:42.0016932Z (pass) inspectAwaitingTicket — approval path > fires clearApproved + persists confirmedAt [0.81ms]
ci Test affected files + coverage 2026-05-21T01:29:42.0022832Z (pass) inspectAwaitingTicket — revise path > appends steering, restarts design, bumps rounds, resets confirmedAt [0.62ms]
ci Test affected files + coverage 2026-05-21T01:29:42.0024746Z (pass) inspectAwaitingTicket — revise path > ignores revise mention inside backticks (e.g. our own plan-ready template) [0.27ms]
ci Test affected files + coverage 2026-05-21T01:29:42.0026862Z (pass) inspectAwaitingTicket — revise path > ignores revise comments at or before lastReviseConsumedAt watermark [0.15ms]
ci Test affected files + coverage 2026-05-21T01:29:42.0029639Z (pass
…[truncated 219921 chars]

```

```

## Fix failing CI checks (2026-05-21T01:17:07.923Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26199524357 ---
ci Test affected files + coverage ﻿2026-05-21T01:15:53.3020332Z ##[group]Run bun run test:affected-files:coverage:ci
ci Test affected files + coverage 2026-05-21T01:15:53.3020964Z [36;1mbun run test:affected-files:coverage:ci[0m
ci Test affected files + coverage 2026-05-21T01:15:53.3071875Z shell: /usr/bin/bash -e {0}
ci Test affected files + coverage 2026-05-21T01:15:53.3072305Z env:
ci Test affected files + coverage 2026-05-21T01:15:53.3072709Z NX_BASE: 562ff5a3e62ccd8b7251a31363f1fd0f75a28ab7
ci Test affected files + coverage 2026-05-21T01:15:53.3073464Z NX_HEAD: a0ef54f851c5785629e6b67fa0215b6bc428df50
ci Test affected files + coverage 2026-05-21T01:15:53.3073936Z ##[endgroup]
ci Test affected files + coverage 2026-05-21T01:15:53.3159516Z $ bun scripts/bun-test-affected-files.ts --coverage
ci Test affected files + coverage 2026-05-21T01:15:53.3393065Z Detecting affected projects...
ci Test affected files + coverage 2026-05-21T01:15:53.3393576Z
ci Test affected files + coverage 2026-05-21T01:15:55.5244611Z agent: 15 relevant test file(s)
ci Test affected files + coverage 2026-05-21T01:15:55.5245259Z apps/agent/src/**tests**/agent-mode-chip.test.tsx
ci Test affected files + coverage 2026-05-21T01:15:55.5245782Z apps/agent/src/**tests**/agent-mode-show-all.test.tsx
ci Test affected files + coverage 2026-05-21T01:15:55.5246426Z apps/agent/src/**tests**/agent-mode-steering.test.tsx
ci Test affected files + coverage 2026-05-21T01:15:55.5246884Z apps/agent/src/**tests**/coordinator-restart-worker.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5247382Z apps/agent/src/**tests**/coordinator.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5247726Z apps/agent/src/**tests**/linear.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5248071Z apps/agent/src/**tests**/poll-context.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5248442Z apps/agent/src/**tests**/queue-order.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5248842Z apps/agent/src/**tests**/wire-setup-worktree.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5249287Z apps/agent/src/shared/capabilities/**tests**/fs-change.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5249766Z apps/agent/src/shared/capabilities/**tests**/gh-client.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5250202Z apps/agent/src/shared/capabilities/**tests**/git.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5250664Z apps/agent/src/shared/capabilities/**tests**/linear-client.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5251190Z apps/agent/src/shared/capabilities/**tests**/run-capability.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5251705Z apps/agent/src/shared/capabilities/**tests**/worker-spawner.test.ts
ci Test affected files + coverage 2026-05-21T01:15:55.5251975Z
ci Test affected files + coverage 2026-05-21T01:15:55.5259228Z bun test v1.3.14 (0d9b296a)
ci Test affected files + coverage 2026-05-21T01:15:55.5357413Z
ci Test affected files + coverage 2026-05-21T01:15:55.5358208Z ##[group]src/**tests**/awaiting-confirmation.test.ts:
ci Test affected files + coverage 2026-05-21T01:15:55.5637269Z (pass) inspectAwaitingTicket — approval path > fires clearApproved + persists confirmedAt [0.82ms]
ci Test affected files + coverage 2026-05-21T01:15:55.5642174Z (pass) inspectAwaitingTicket — revise path > appends steering, restarts design, bumps rounds, resets confirmedAt [0.54ms]
ci Test affected files + coverage 2026-05-21T01:15:55.5644695Z (pass) inspectAwaitingTicket — revise path > ignores revise mention inside backticks (e.g. our own plan-ready template) [0.24ms]
ci Test affected files + coverage 2026-05-21T01:15:55.5646792Z (pass) inspectAwaitingTicket — revise path > ignores revise comments at or before lastReviseConsumedAt watermark [0.18ms]
ci Test affected files + coverage 2026-05-21T01:15:55.5650247Z (pass
…[truncated 219847 chars]

```

```

## Fix failing CI checks (2026-05-21T01:11:12.472Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26199334122 ---
ci Unused dependency check ﻿2026-05-21T01:09:53.1310353Z ##[group]Run bun run check:unused:ci
ci Unused dependency check 2026-05-21T01:09:53.1310710Z [36;1mbun run check:unused:ci[0m
ci Unused dependency check 2026-05-21T01:09:53.1344057Z shell: /usr/bin/bash -e {0}
ci Unused dependency check 2026-05-21T01:09:53.1344327Z env:
ci Unused dependency check 2026-05-21T01:09:53.1344569Z NX_BASE: 562ff5a3e62ccd8b7251a31363f1fd0f75a28ab7
ci Unused dependency check 2026-05-21T01:09:53.1344922Z NX_HEAD: 58b2c4f98545db4118afe665226a85a600bb52e4
ci Unused dependency check 2026-05-21T01:09:53.1345215Z ##[endgroup]
ci Unused dependency check 2026-05-21T01:09:53.1417738Z $ knip
ci Unused dependency check 2026-05-21T01:09:56.7990612Z [93m[4mUnused exports[24m[39m (11)
ci Unused dependency check 2026-05-21T01:09:56.8076456Z linearRequest apps/agent/src/agent/linear.ts:45:3  
ci Unused dependency check 2026-05-21T01:09:56.8077717Z scaffold apps/agent/src/shared/capabilities/fs-change.ts:54:14  
ci Unused dependency check 2026-05-21T01:09:56.8078919Z prependTask apps/agent/src/shared/capabilities/fs-change.ts:69:14  
ci Unused dependency check 2026-05-21T01:09:56.8080151Z appendSteering apps/agent/src/shared/capabilities/fs-change.ts:79:14  
ci Unused dependency check 2026-05-21T01:09:56.8081337Z GH_RETRY apps/agent/src/shared/capabilities/gh-client.ts:90:14  
ci Unused dependency check 2026-05-21T01:09:56.8083440Z createWorktree apps/agent/src/shared/capabilities/git.ts:50:14  
ci Unused dependency check 2026-05-21T01:09:56.8084633Z removeWorktree apps/agent/src/shared/capabilities/git.ts:59:14  
ci Unused dependency check 2026-05-21T01:09:56.8085865Z seedWorktreeMcpConfig apps/agent/src/shared/capabilities/git.ts:67:14  
ci Unused dependency check 2026-05-21T01:09:56.8087287Z linearRequest apps/agent/src/shared/capabilities/linear-client.ts:456:10
ci Unused dependency check 2026-05-21T01:09:56.8088458Z runCapabilityInternals apps/agent/src/shared/capabilities/run-capability.ts:71:14
ci Unused dependency check 2026-05-21T01:09:56.8089862Z workerSpawner apps/agent/src/shared/capabilities/worker-spawner.ts:81:14
ci Unused dependency check 2026-05-21T01:09:56.8090820Z [93m[4mUnused exported types[24m[39m (11)
ci Unused dependency check 2026-05-21T01:09:56.8091990Z ScaffoldArgs interface apps/agent/src/shared/capabilities/fs-change.ts:24:18  
ci Unused dependency check 2026-05-21T01:09:56.8093206Z PrependTaskArgs interface apps/agent/src/shared/capabilities/fs-change.ts:37:18  
ci Unused dependency check 2026-05-21T01:09:56.8094433Z AppendSteeringArgs interface apps/agent/src/shared/capabilities/fs-change.ts:44:18  
ci Unused dependency check 2026-05-21T01:09:56.8095629Z GhRunArgs interface apps/agent/src/shared/capabilities/gh-client.ts:22:18  
ci Unused dependency check 2026-05-21T01:09:56.8096755Z GhResult interface apps/agent/src/shared/capabilities/gh-client.ts:29:18  
ci Unused dependency check 2026-05-21T01:09:56.8097923Z CreateWorktreeArgs interface apps/agent/src/shared/capabilities/git.ts:23:18  
ci Unused dependency check 2026-05-21T01:09:56.8099148Z RemoveWorktreeArgs interface apps/agent/src/shared/capabilities/git.ts:30:18  
ci Unused dependency check 2026-05-21T01:09:56.8100299Z SeedMcpConfigArgs interface apps/agent/src/shared/capabilities/git.ts:36:18  
ci Unused dependency check 2026-05-21T01:09:56.8101479Z WorktreeHandle interface apps/agent/src/shared/capabilities/git.ts:41:18  
ci Unused dependency check 2026-05-21T01:09:56.8102910Z RunCapabilityCtx interface apps/agent/src/shared/capabilities/run-capability.ts:21:18
ci Unused dependency check 2026-05-21T01:09:56.8104097Z SpawnWorkerArgs interface apps/agent/src/shared/capabilities/worker-spawner
…[truncated 224062 chars]

```

```

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
