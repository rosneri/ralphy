# RLF-137: Confirmation gate releases due to worktree-path mismatch — short worktree dir vs long changeName

Source: [RLF-137](https://linear.app/neriros/issue/RLF-137/confirmation-gate-releases-due-to-worktree-path-mismatch-short)
Status: In Progress
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Why

Third leak in the confirmation-gate respawn family ([RLF-105](https://linear.app/neriros/issue/RLF-105), [RLF-118](https://linear.app/neriros/issue/RLF-118)). Two functions describe the on-disk location of an issue's worktree using **two different naming schemes**:

- `apps/agent/src/agent/wire/prepare.ts:85` creates the worktree under `<worktreesDir>/<issue.identifier.toLowerCase()>` — the **short** Linear identifier, e.g. `rlf-101`.
- `apps/agent/src/features/confirmation/awaiting.ts:49` looks the worktree up at `<worktreesDir>/<changeName>` — the **full** openspec slug `<identifier>-<title-slug>`, e.g. `rlf-101-manual-test-b-add-add-a-b-confirmation`.

Result: `resolveChangeCwdForIssue` builds a path that does not exist, falls back to `projectRoot`, finds no `tasks.md`, and the gate releases with `tasks-empty`. The next poll respawns the worker, the worker pushes a PR without confirmation, and the gate's "no implementation before approval" invariant is violated.

The RLF-118 regression test missed this because it seeds `<projectRoot>/openspec/changes/<changeName>/tasks.md` at the project root and never exercises the worktree-name path.

## What Changes

- Introduce `worktreeDirNameForIssue(issue)` in `apps/agent/src/agent/worktree.ts` as the single source of truth for the on-disk worktree directory name (the short identifier, matching what `prepare.ts` already creates).
- Switch `prepare.ts` to call the new helper instead of inlining `issue.identifier.toLowerCase()`.
- Update `resolveChangeCwdForIssue` in `awaiting.ts` to accept the issue (or short identifier) and look the worktree up at `<worktreesDir>/<short-identifier>`. Keep a fallback that also probes `<worktreesDir>/<changeName>` so legacy worktrees still resolve.
- Add a regression test that creates `<worktreesDir>/<short-identifier>/openspec/changes/<changeName>/tasks.md` and asserts the gate stays claimed (no `tasks-empty` release).

## Acceptance criteria

- `processAwaitingForIssue` resolves the worktree path correctly when the worktree directory uses the short Linear identifier and the openspec change uses the full slug — the gate does NOT release with `tasks-empty`.
- A new unit test exercises that exact path layout and would fail against the current `awaiting.ts:49` code.
- `bun run lint` and `bun run test` are green.

## Steering

_Add steering notes here as the loop runs._
