# RLF-257: refactor(epic): decompose post-task.ts (1395 LOC) into a named-phase pipeline

Source: [RLF-257](https://linear.app/neriros/issue/RLF-257/refactorepic-decompose-post-taskts-1395-loc-into-a-named-phase)
Status: Todo

## Why

_Migrated from GitHub issue [rosneri/ralphy#422](https://github.com/rosneri/ralphy/issues/422). Original labels: architecture, epic._

## Context (EPIC)

`apps/agent/src/agent/post-task.ts` (1395 LOC) is the single largest maintainability hazard in the repo: a god‑orchestrator fusing PR creation, conflict‑merge, fix‑loop respawn, validate, cleanup, teardown, and retro into one function body, with **cleanup + teardown copy‑pasted across four terminal return sites**. A missed cleanup in one branch leaks worktrees/processes; the duplication guarantees drift.

Related closed RFC: #402 (effects‑as‑data decomposition — this extends it into the post‑task surface).

## Current state (verified 2026-06-13)

- `apps/agent/src/agent/post-task.ts` ≈ 1395 LOC.
- Distinct concerns interleaved: PR creation (`createPrWithRetry`), conflict‑fix verify, fix‑loop respawn, validate, cleanup, teardown, retro — roughly `:427-602`, `:684-923`, `:1152-1395`.
- Cleanup + teardown duplicated at 4 terminal return sites (find them):

  ```bash
  rg -n 'teardown|cleanup|return\s*\{' apps/agent/src/agent/post-task.ts | head -40
  ```

- ~11 inline `git`/`gh` calls (coordinate with the CodeHost‑routing epic).

## Goal

`post-task.ts` becomes a thin orchestrator over **named phase handlers**, each `(ctx) => { effectiveCode, terminal }`, with cleanup + teardown run **exactly once** in a single `finally`‑style path. No behavior change.

## Sub‑tasks (land as separate sub‑PRs, each green on its own)

- [ ] **11a — Single teardown.** Extract one `runTeardown(ctx)` and restructure so all terminal paths flow through one `finally` that calls it exactly once. Add a test asserting teardown runs once per outcome (success, ci‑failed, pr‑failed, no‑changes, throw). This is the highest‑value step — do it first.
- [ ] **11b — Extract** `createPrWithRetry` **+ merge‑resolution** into their own module(s) with focused tests.
- [ ] **11c — Extract conflict‑fix verify** into its own module.
- [ ] **11d — Extract the fix‑loop respawn tier** (the agent's outer respawn orchestration) into a named module; document its stop semantics (it is a separate authority from `loopMachine`).
- [ ] **11e — Model the body as a phase pipeline:** an ordered list of phase handlers each returning `{ effectiveCode, terminal }`; the orchestrator runs them until one is terminal, then the single teardown. Replace the copy‑pasted return sites.
- [ ] **11f — Size guard.** Once decomposed, add `post-task.ts` (and a global threshold) to a per‑file LOC budget check so it cannot regrow (coordinate with the guardrails wave; at minimum assert `post-task.ts` is under, say, 400 LOC in a structure test).

## Acceptance criteria

- [ ] Cleanup + teardown exist in exactly one place and run once per outcome (covered by a test).
- [ ] `post-task.ts` is a thin orchestrator; PR creation, conflict verify, and respawn live in their own modules; the file is well under its previous size.
- [ ] Behavior is unchanged: all existing `apps/agent` post‑task tests pass; **coverage is not reduced** (add tests for newly extracted modules).
- [ ] `bun run typecheck`, `bun run check:structure`, `bun test apps/agent/src` pass.

## Verification

```bash
wc -l apps/agent/src/agent/post-task.ts        # expect: « 1395 (target < ~400)
bun run typecheck && bun run check:structure
bun test apps/agent/src
```

## Risk / blast radius

**High** (the worker terminal path controls worktree/process cleanup). Strictly behavior‑preserving; land sub‑PRs incrementally with the full `apps/agent` suite green each time. Start with 11a (single teardown) — it both de‑risks and delivers the most value.

## Effort

**L** (epic; ~6 sub‑PRs). Sequence after issue 10 (agent config) and the exit‑code/vocabulary unification (issues 6, 8) where they overlap.

---

_Filed from a multi-agent architecture audit (adversarially verified against the codebase at_ `main`_, 2026-06-13). Part of an 11-issue "raise the bar" suite; relates to closed RFCs #401–#405._

## What Changes

- **Single teardown (keystone, do first).** Restructure `runPostTask` so all terminal outcomes flow through one shared exit path that runs worktree cleanup + teardown **exactly once**. Today the `runWorktreeCleanupPhase` + `runTeardownPhase` pair is copy-pasted at **4 terminal return sites** (validate-only `:1209`, conflict-fix unpushed-guard `:1265`, conflict-fix verify success `:1333`, main path `:1386`). A missed cleanup in any new branch leaks worktrees/processes; the duplication guarantees drift.
- **Move the surface into a `agent/post-task/` subdirectory.** `apps/agent/src/agent/` already holds 9 top-level source files against the `check-folder-size` cap of 10, so new sibling files would break the structure gate. `post-task.ts` becomes `post-task/index.ts` (the `../agent/post-task` import path resolves unchanged) and extracted modules live beside it.
- **Extract PR creation + merge-resolution** (`createPrWithRetry` and its non-fast-forward merge/conflict handling) into `post-task/pr-create.ts` with focused tests.
- **Extract the PR phase** (`runPrPhase`, `findNeverTouchViolations`, `findExistingOpenPrUrl`, `detectRepoAutoMergeAllowed`, `_resetRepoAutoMergeCache`) into `post-task/pr-phase.ts`.
- **Extract conflict-fix verify** (the `mode === "conflict-fix"` mergeability-probe block, including the unpushed-divergence guard) into `post-task/conflict-fix-verify.ts`.
- **Extract the respawn tier** (`runWorkerWithFixTask` + `reactivateState`, the append-only history guard) into `post-task/respawn.ts`, documenting that its stop semantics are a separate authority from `loopMachine`.
- **Extract validate-only** (`runValidateOnlyPhase` + `defaultRunCommand`) into `post-task/validate-only.ts`, and cleanup/teardown into `post-task/cleanup.ts` / `post-task/teardown.ts`.
- **Model the body as a phase pipeline:** the orchestrator runs an ordered list of phase handlers (each returning `{ effectiveCode, terminal }`) until one is terminal, then the single teardown — replacing the copy-pasted return sites.
- **Size guard.** Add a structure test asserting the orchestrator entry file stays under its budget (target < ~400 LOC) so it cannot regrow.
- **No behavior change.** Public exports stay importable from `../agent/post-task`; every existing `apps/agent` post-task test passes; coverage is not reduced (new tests cover the extracted modules).

## Additional instructions

You are working on RLF-257: refactor(epic): decompose post-task.ts (1395 LOC) into a named-phase pipeline.

Project rules:

- use Bun-native APIs (Bun.spawn / Bun.file) — never node:fs sync
- never reduce coverage threshold
- strive to write code in packages and only consume it from apps

Never modify: dist/**, .claude/worktrees/**.

## Steering

_Add steering notes here as the loop runs._
