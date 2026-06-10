# RLF-107: Sandbox worker git push to its own branch

Source: [RLF-107](https://linear.app/neriros/issue/RLF-107/worker-self-pushes-to-base-branch-force-pushes-own-branch-when-test)
Status: Done
Assignee: Neriya Rosner
Labels: ralph:auto-merge

## Why

The worker subprocess inherits the operator's full git push capability. A poorly-worded (or hostile) Linear ticket description can — and did, in scenario D — cause the worker to:

1. `git push origin main` (commit a "conflict" to the base branch itself), and
2. `git push -f origin ralph/<change>` (force-push its own branch, destroying ralph's view of prior state).

Even with `--worktree`, the worktree shares the parent repo's `.git` dir, so the worker has unrestricted push access to every remote ref. Ralph's routing (conflict-fix flow, label-driven preempt, etc.) is bypassed entirely, and the operator-side acceptance steps inside ticket descriptions become engine-actionable instructions.

The worker should be confined to pushing only its own `ralph/<change>` branch, never the base branch, and force-push should only be possible when ralph itself opts in.

## What Changes

- Install a per-worktree `pre-push` hook when `createWorktree` provisions a worktree. The hook rejects any push whose remote ref is not `refs/heads/ralph/*`, and rejects force pushes unless the env var `RALPH_ALLOW_FORCE_PUSH=1` is set by ralph itself.
- Point the worktree at the per-worktree hook dir via `git config core.hooksPath <worktree>/.ralph-hooks` so the hook is scoped to the worktree and never leaks into the parent repo.
- The hook is written with Bun.write at worktree-create time; the file is `chmod +x` and lives outside any tracked path.
- Surface the rejection clearly so a worker that tries an illegal push fails fast with a stderr message naming the policy (and the ticket can be flagged for re-routing rather than the worker silently scribbling on main).
- Add a unit test exercising `createWorktree` to assert the hook file and `core.hooksPath` config are present, and a hook-script test that simulates pre-push stdin and asserts the allow/deny matrix.
- Document the policy in the design doc and in the hook script itself (a worker reading the script needs to know _why_ the push was rejected).

## Acceptance Criteria

- After `createWorktree`, `<worktree>/.ralph-hooks/pre-push` exists, is executable, and `git config core.hooksPath` inside that worktree resolves to `<worktree>/.ralph-hooks`.
- Pushing `refs/heads/ralph/rlf-anything` from inside the worktree is allowed (non-force).
- Pushing `refs/heads/main` (or anything not matching `refs/heads/ralph/*`) from inside the worktree is rejected with exit 1 and an explanatory stderr.
- A force push (`+refs/...` on the input line, or git's "forced update" flag) is rejected unless `RALPH_ALLOW_FORCE_PUSH=1` is exported in the env.
- `bun run lint` and `bun run test` both pass.

## Steering

_Add steering notes here as the loop runs._
