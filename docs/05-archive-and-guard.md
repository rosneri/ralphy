## Context

`#405` flagged stale change‑doc status; it has **drifted worse**. 100 completed change directories sit unarchived in `openspec/changes/` while `openspec/changes/archive/` holds exactly **1**. The auto‑archive flow _is_ wired into the headless loop (`packages/core/src/loop-runner/index.ts:504` → `changeStore.archiveChange`) but it is gated by an uncommitted‑worktree refusal + a completeness check and, per the audit, **swallows failures** — so a backlog accumulated silently. Two fixes: make archive failures visible, and add a guard that catches the backlog before it grows.

Related closed RFC: #405.

## Current state (verified 2026-06-13)

```bash
ls openspec/changes/ | rg -v '^archive$' | wc -l   # → 100 unarchived
ls openspec/changes/archive/ | wc -l               # → 1 archived
```

- `packages/openspec/src/openspec-change-store.ts:246` `archiveChange(name)` runs `openspec archive <name> -y` and throws on failure.
- `packages/core/src/loop-runner/index.ts:462-504` is the archive path: it refuses on a dirty worktree (462), skips with `Archive skipped: openspec status reports change incomplete` (499), then calls `archiveChange` (504). Confirm whether the surrounding `try/catch` logs vs. silently swallows a thrown archive error.

## Scope

- **In:** (a) ensure archive failures in the loop‑runner are logged with the change name + reason (never silently swallowed); (b) add `scripts/check-stale-changes.ts` that reports completed‑but‑unarchived changes; (c) add a `scripts/archive-completed-changes.ts` maintenance script that archives every _completed_ change (status‑checked, defensive) and prints a summary.
- **Out:** bulk‑archiving the 100 dirs by hand in this PR (the maintainer runs the new script as a one‑time step). Do not force‑archive incomplete changes.

## Plan

1. **Loop‑runner fix:** in `packages/core/src/loop-runner/index.ts` around 480–504, wrap the `archiveChange` call so a thrown error is logged via the existing logger/progress channel as `Archive failed for "<name>": <message>` and surfaced (e.g. emitted as a warning event), not swallowed. Add/extend a unit test in `packages/core/src/__tests__` that asserts a failing `archiveChange` produces a logged warning (patch `Bun.spawnSync`/the changeStore per the repo's test rules — do **not** `mock.module`).
2. **Guard script** `scripts/check-stale-changes.ts` (Bun style — see any existing `scripts/check-*.ts`): list `openspec/changes/*` (excluding `archive/`), and for each whose `tasks.md` is fully checked off but is not archived, collect it. Print the list; exit non‑zero if the count exceeds a threshold (start lenient, e.g. fail above the current backlog so it only ratchets down — never up). Add `"check:stale-changes": "bun scripts/check-stale-changes.ts"` to `package.json` and include it in `check:structure`.
3. **Maintenance script** `scripts/archive-completed-changes.ts`: for each completed change, call the same archive entry point the loop uses (or `openspec archive <name> -y`), skip incomplete ones, and print `archived N, skipped M (reasons)`. Defensive: never throw the whole run on one failure — collect and report.
4. Add `scripts/__tests__` coverage for the guard's completed‑vs‑incomplete classification.

## Acceptance criteria

- [ ] A failing archive in the loop‑runner is logged with the change name and reason and covered by a test.
- [ ] `bun scripts/check-stale-changes.ts` prints the backlog and exits non‑zero only above the (ratcheting) threshold.
- [ ] `bun scripts/archive-completed-changes.ts` archives completed changes and skips incomplete ones without crashing on a single failure.
- [ ] `check:stale-changes` is wired into `package.json` `check:structure`.
- [ ] `bun run typecheck`, `bun run lint`, `bun test` (core + scripts) pass; coverage not reduced.

## Verification (all must pass)

```bash
bun scripts/check-stale-changes.ts; echo "exit=$?"
bun test packages/core/src scripts/__tests__
bun run typecheck && bun run lint
```

## Risk / blast radius

**Low.** The loop‑runner change only adds logging around an existing call. The scripts are additive. The maintenance script is opt‑in (run by a human); it must never archive incomplete changes.

## Effort

**M** (≈2–3 h).

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at `main`, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._
