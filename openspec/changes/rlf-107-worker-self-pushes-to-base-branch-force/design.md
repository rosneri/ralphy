# Design for RLF-107

## Goal

Prevent a worker subprocess running inside a `ralph/<change>` worktree from pushing to any ref other than its own branch, and from force-pushing even its own branch (unless ralph itself opts in).

## Approach: per-worktree `pre-push` hook

When `apps/agent/src/agent/worktree.ts#createWorktree` finishes provisioning a worktree, it now also:

1. Writes `<worktree>/.ralph-hooks/pre-push` (executable) — a small bash script that reads the per-push stdin lines (`<local ref> <local sha> <remote ref> <remote sha>`) and rejects entries where:
   - `<remote ref>` does not match `refs/heads/ralph/*`, OR
   - `<local sha>` indicates a force update (git pre-push receives the would-be remote sha; if the remote sha is non-zero and not an ancestor of local sha, this is a force update — git itself passes `--force` via the env var `GIT_PUSH_OPTION_*`; simpler: check `RALPH_ALLOW_FORCE_PUSH` and use `git merge-base --is-ancestor <remote_sha> <local_sha>` to detect rewrites).
2. Runs `git config core.hooksPath <worktree>/.ralph-hooks` inside the worktree so git uses the new hook dir for _this_ worktree only. Worktrees share `.git/config` only at the common-dir level; `core.hooksPath` is a worktree-local config when set via `--worktree` or just inside the worktree, and git resolves it relative to the worktree.

We intentionally do NOT install the hook in the parent repo's `.git/hooks/` because that would affect non-ralph workflows.

The `.ralph-hooks/` directory is created fresh per worktree and never tracked.

## Files touched

- `apps/agent/src/agent/worktree.ts` — new `installPrePushHook(cwd, runner)` helper called from `createWorktree` after the `worktree add`. Idempotent (overwrite is fine — content is constant).
- `apps/agent/src/agent/__tests__/worktree.test.ts` (or `apps/agent/src/__tests__/worktree.test.ts`) — assert the file is written and `core.hooksPath` is configured.
- New `apps/agent/src/agent/__tests__/pre-push-hook.test.ts` — drives the hook script via `Bun.spawn` with crafted stdin and asserts the allow/deny matrix.

## Hook script (sketch)

```bash
#!/usr/bin/env bash
# Installed by ralphy createWorktree (RLF-107).
# Rejects any push whose remote ref is not refs/heads/ralph/*,
# and rejects force pushes unless RALPH_ALLOW_FORCE_PUSH=1.
set -euo pipefail
ZERO="0000000000000000000000000000000000000000"
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/ralph/*) ;;
    *) echo "ralph: refusing push to $remote_ref (only refs/heads/ralph/* allowed)" >&2; exit 1 ;;
  esac
  if [ "$remote_sha" != "$ZERO" ] && [ "${RALPH_ALLOW_FORCE_PUSH:-0}" != "1" ]; then
    if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
      echo "ralph: refusing force-push to $remote_ref (set RALPH_ALLOW_FORCE_PUSH=1 to override)" >&2
      exit 1
    fi
  fi
done
exit 0
```

## Data flow

```
createWorktree
  └── worktree add ...
  └── installPrePushHook(cwd, runner)
        ├── Bun.write(<cwd>/.ralph-hooks/pre-push, SCRIPT)
        ├── chmod +x (via Bun.spawn)
        └── git config core.hooksPath .ralph-hooks   (relative inside the worktree)
```

## Edge cases

- **Resume path**: when the worktree already exists, `createWorktree` returns early. We must still ensure the hook is installed on the resume path — call `installPrePushHook` unconditionally before returning the handle so older worktrees pick it up on the next iteration.
- **Branch already exists locally**: same — install hook after `worktree add <cwd> <branch>`.
- **chmod**: use `Bun.spawn(["chmod", "+x", path])` rather than `node:fs` sync (per project rules).
- **`RALPH_ALLOW_FORCE_PUSH` opt-in**: ralph itself does not currently force-push from inside the worker subprocess, so the default closed state is safe. If a future preempt feature needs it, it can set the env var.
- **Hook bypass via `--no-verify`**: git's `--no-verify` skips hooks. There's no in-git way to prevent that, but the worker is invoked from ralph's own runner — ralph does not pass `--no-verify` and the worker's free-form git invocations would have to know to add it. Document the limitation in the design but do not chase it in this change.
- **Pushes from ralph's own coordinator process** (outside any worktree): unaffected, because `core.hooksPath` is only set inside the worktree's config.

## Out of scope

- Capability-layer interception of arbitrary `git push` / `gh` shell calls.
- Tightening `boundaries.never_touch` for `.ralph/**` / `.mcp.json` commits (separate follow-up from RLF-105 notes).
- Preventing operator-instruction leakage in ticket descriptions (this is a defense-in-depth fix; the prompt-safety angle is separate).
