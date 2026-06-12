## Context (EPIC)

The `#403` `CodeHost` port exists and is partly used, but its read/probe surface is **bypassed** by hand‑rolled `gh`/`git` subprocess calls scattered across the agent. This defeats the port (no single place to mock, change backend, or fix a `gh` invocation) and has already produced duplicate, drifting implementations.

Related closed RFC: #403.

## Current state (verified 2026-06-13)

- `apps/agent/src/agent/post-task.ts` issues ~11 raw `git`/`gh` subprocess calls inline (e.g. around `:300`, `:635-640`, `:877-901`).
- 4 hand‑rolled `gh pr view` PR‑state probes: `apps/agent/src/agent/wire/pr-helpers.ts:36,162`, `apps/agent/src/pr-status.ts:106`, + one more (find with rg below).
- A verbatim copy of the CodeHost idempotency query lives in app code.
- 3 separate CI‑status bucketing implementations: `packages/codehost/src/gh-cli.ts:152`, `apps/agent/src/pr-status.ts:30,33`.
- `CodeHost` is constructed ad‑hoc in ~4 sites instead of injected once (`wire.ts:190`, `post-task.ts:877,901`, …).
- `getPullRequestState` already exists on the port but has **zero callers**.

Discovery greps:

```bash
rg -n "Bun\.spawn|spawnSync|\bgh \b|\bgit \b" apps/agent/src/agent/post-task.ts
rg -n "gh pr view" apps/agent/src --type ts | rg -v '__tests__'
rg -n "new GhCli|createCodeHost|codeHost =" apps/agent/src --type ts | rg -v '__tests__'
```

## Goal

All PR/CI/git operations in the agent go through a **single injected `CodeHost` instance**. The port owns: PR state (use the existing `getPullRequestState`), CI bucketing (one implementation), the idempotency query, auto‑merge capability detection, and branch diff/status/merge/fetch.

## Sub‑tasks (land as separate sub‑PRs)

- [ ] **9a — Single CodeHost instance.** Build the `CodeHost` once (like the tracker bundle is built once) and thread it through; delete the ~4 ad‑hoc constructions. No behavior change.
- [ ] **9b — Route the 4 `gh pr view` probes** through `codeHost.getPullRequestState(...)` (already on the port, currently 0 callers). Delete `pr-helpers.ts`'s hand‑rolled probes.
- [ ] **9c — One CI bucketer.** Keep `packages/codehost/src/gh-cli.ts`'s implementation; delete the `pr-status.ts` copies and call the port. Add a unit test pinning the bucketing for pass/fail/pending fixtures.
- [ ] **9d — Idempotency query** lives only in the port; delete the verbatim app‑code copy and call the port method.
- [ ] **9e — post-task git/gh.** Extend the port with the missing operations (auto‑merge capability, branch diff/status, merge, fetch) and route post-task.ts's ~11 inline calls through it. (This dovetails with the post-task decomposition epic — coordinate ordering.)

## Acceptance criteria

- [ ] No `gh pr view` or raw `gh`/`git` PR‑CI subprocess calls remain in `apps/agent/src` outside `packages/codehost` (verified by rg).
- [ ] CI bucketing has exactly one implementation; `getPullRequestState` has real callers.
- [ ] `CodeHost` is constructed once and injected.
- [ ] `bun run typecheck`, `bun run check:deps`, `bun run check:structure` (incl. `check-tracker-seam`), `bun test apps/agent/src packages/codehost/src` pass; coverage not reduced.

## Verification

```bash
rg -n "gh pr view" apps/agent/src --type ts | rg -v '__tests__'        # expect: no output
rg -n "Bun\.spawn.*\b(gh|git)\b" apps/agent/src/agent/post-task.ts      # expect: none after 9e
bun run typecheck && bun run check:deps && bun run check:structure
bun test apps/agent/src packages/codehost/src
```

## Risk / blast radius

**Medium–High** (touches live PR/CI flow). Land 9a–9e independently; each must keep `bun test apps/agent/src` green. Prefer landing **after** the post-task decomposition (issue 11) for 9e, or coordinate.

## Effort

**L** (epic; ~5 sub‑PRs).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
