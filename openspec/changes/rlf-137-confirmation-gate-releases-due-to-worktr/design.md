# Design for RLF-137

## Root cause

Two functions disagree on the on-disk worktree directory name:

| Caller                                                                        | Path it constructs                                | Naming scheme                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `apps/agent/src/agent/wire/prepare.ts:85` (creates the worktree)              | `<worktreesDir>/<issue.identifier.toLowerCase()>` | short identifier (`rlf-101`)                     |
| `apps/agent/src/features/confirmation/awaiting.ts:49` (looks the worktree up) | `<worktreesDir>/<changeName>`                     | full openspec slug (`rlf-101-manual-test-b-...`) |

`changeNameForIssue` in `apps/agent/src/agent/scaffold.ts:9` produces the long slug; the worktree creator never uses it. The confirmation lookup assumes it does.

## Approach

**Option A (single source of truth) + Option B (defensive fallback) combined.**

1. Add `worktreeDirNameForIssue(issue: { identifier: string }): string` to `apps/agent/src/agent/worktree.ts`. Returns `issue.identifier.toLowerCase()`. This becomes the canonical on-disk worktree dir-name.
2. `prepare.ts:85` calls the helper instead of inlining the lowercase identifier.
3. `awaiting.ts:resolveChangeCwdForIssue` takes the issue (we already have it at the call site `awaiting.ts:140`) and resolves the worktree path as:
   - Probe 1 (canonical): `<worktreesDir>/<worktreeDirNameForIssue(issue)>` — check `openspec/changes/<changeName>/tasks.md` exists.
   - Probe 2 (legacy fallback): `<worktreesDir>/<changeName>` — same check. Covers any in-flight worktree from before the fix.
   - Fall back to `projectRoot` only if neither probe finds tasks.md.

## Files to touch

- `apps/agent/src/agent/worktree.ts` — add `worktreeDirNameForIssue`.
- `apps/agent/src/agent/wire/prepare.ts` — use the helper.
- `apps/agent/src/features/confirmation/awaiting.ts` — pass `issue` into `resolveChangeCwdForIssue`; probe both paths.
- `apps/agent/src/features/confirmation/__tests__/awaiting.test.ts` — add the short-worktree-name regression scenario.
- Spec delta under `openspec/changes/rlf-137-.../specs/confirmation/spec.md`.

## Data flow

```
issue (RLF-101, title "Manual test B...")
  ├─ changeNameForIssue   → "rlf-101-manual-test-b-add-add-a-b-confirmation"  (openspec)
  └─ worktreeDirNameForIssue → "rlf-101"                                       (filesystem)

createWorktree(projectRoot, "rlf-101", ...) → ~/.ralph/<proj>/worktrees/rlf-101
scaffoldChangeForIssue(...)                 → .../worktrees/rlf-101/openspec/changes/rlf-101-manual-test-b-.../

resolveChangeCwdForIssue(issue, changeName):
  1. cwdOf(changeName)   → tracked? return.
  2. <wt>/rlf-101/openspec/changes/rlf-101-manual-test-b-.../tasks.md → exists? return <wt>/rlf-101.
  3. <wt>/rlf-101-manual-test-b-.../openspec/changes/.../tasks.md     → exists? return that (legacy).
  4. else projectRoot.
```

## Edge cases

- **`useWorktree=false`**: keep returning `projectRoot` — unchanged.
- **Tracked cwd via `cwdOf`**: still returns first — unchanged.
- **Identifier casing/punctuation**: `issue.identifier.toLowerCase()` is what `prepare.ts` already does; no normalization changes needed.
- **Worktree exists but tasks.md missing** (true tasks-empty): still falls back to projectRoot — the new probe layering doesn't mask genuine empty-tasks releases.

## Why not change the worktree to use the long changeName

Less disruptive to keep the existing on-disk layout (short identifier) — branches are already `ralph/<short>`, PR titles reference the short identifier, and existing live worktrees would all need rename/cleanup. The lookup side is the cheap side to fix.
