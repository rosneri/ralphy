## Manual Testing

- [x] Single gated ticket: start ralph with one awaiting-confirmation ticket and verify exactly one [GATE] card renders with no "+N more" line
- [x] Multiple gated tickets: simulate two gated tickets and verify only the latest (newest since) card renders plus a "+1 more awaiting confirmation" dimmed line below it
- [x] Three gated tickets counter: simulate three gated tickets and verify "+2 more awaiting confirmation" appears
- [x] Null since treated as oldest: verify that a ticket with null since is not selected as "top" when another ticket has a real timestamp
- [x] No gated tickets: verify the gated section is absent (no [GATE] card, no counter line) when gatedTickets map is empty

## Fix failing CI checks (2026-05-27T15:22:00.743Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
CI is failing on this PR. Investigate and fix:

```

--- run 26520523198 ---
ci Security audit ﻿2026-05-27T15:21:13.6507914Z ##[group]Run bun audit --audit-level=high
ci Security audit 2026-05-27T15:21:13.6508422Z [36;1mbun audit --audit-level=high[0m
ci Security audit 2026-05-27T15:21:13.6545796Z shell: /usr/bin/bash -e {0}
ci Security audit 2026-05-27T15:21:13.6546101Z env:
ci Security audit 2026-05-27T15:21:13.6546374Z NX_BASE: 7c8226dbfc65036ed5af44776f2f33de9df0f211
ci Security audit 2026-05-27T15:21:13.6546745Z NX_HEAD: 19c3b17e65ad29d35a02de754152e5bc7cde9a5a
ci Security audit 2026-05-27T15:21:13.6547053Z ##[endgroup]
ci Security audit 2026-05-27T15:21:13.6631336Z [0m[1mbun audit [0m[2mv1.3.14 (0d9b296a)[0m
ci Security audit 2026-05-27T15:21:13.9089365Z tmp <0.2.6
ci Security audit 2026-05-27T15:21:13.9090027Z nx › tmp
ci Security audit 2026-05-27T15:21:13.9090844Z high: tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape - https://github.com/advisories/GHSA-ph9p-34f9-6g65
ci Security audit 2026-05-27T15:21:13.9091830Z
ci Security audit 2026-05-27T15:21:13.9091991Z 1 vulnerabilities (1 high)
ci Security audit 2026-05-27T15:21:13.9092181Z
ci Security audit 2026-05-27T15:21:13.9092640Z To update all dependencies to the latest compatible versions:
ci Security audit 2026-05-27T15:21:13.9093026Z bun update
ci Security audit 2026-05-27T15:21:13.9093162Z
ci Security audit 2026-05-27T15:21:13.9093535Z To update all dependencies to the latest versions (including breaking changes):
ci Security audit 2026-05-27T15:21:13.9093976Z bun update --latest
ci Security audit 2026-05-27T15:21:13.9094132Z
ci Security audit 2026-05-27T15:21:13.9110340Z ##[error]Process completed with exit code 1.

```

```
