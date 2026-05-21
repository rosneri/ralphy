# worker-sandbox — per-worktree git push policy

## ADDED Requirements

### Requirement: `createWorktree` MUST install a `pre-push` hook that confines pushes to `refs/heads/ralph/*` and forbids force-pushes by default

When `apps/agent/src/agent/worktree.ts#createWorktree` provisions or resumes a worktree, it MUST install an executable `pre-push` hook at `<worktree>/.ralph-hooks/pre-push` and configure `core.hooksPath` (inside that worktree) to `.ralph-hooks` so git invokes the hook for every push originating from the worktree.

The hook MUST:

- Reject (exit non-zero) any push line whose `<remote ref>` does not match `refs/heads/ralph/*`, printing a one-line stderr message naming the rejected ref.
- Reject (exit non-zero) any push that would rewrite history on the remote (`<remote_sha>` not an ancestor of `<local_sha>`, and `<remote_sha>` is not the all-zero sha) UNLESS the environment variable `RALPH_ALLOW_FORCE_PUSH=1` is set.
- Allow all other pushes through with exit 0.

The hook MUST be installed on both the fresh-create path and the resume path (existing worktree, existing branch) so older worktrees are upgraded on the next iteration.

The hook directory MUST be `.ralph-hooks/` inside the worktree (not the parent repo's `.git/hooks/`) so the policy is scoped to the worktree and does not affect operator git activity in the parent checkout.

#### Scenario: fresh worktree has the hook and config

- **Given** `createWorktree(projectRoot, "rlf-x", "main", runner)` is called against a clean parent repo
- **When** the call returns
- **Then** the file `<worktree>/.ralph-hooks/pre-push` exists and is executable
- **And** `git config core.hooksPath` inside the worktree resolves to `.ralph-hooks` (or its absolute equivalent)

#### Scenario: hook rejects push to base branch

- **Given** an installed `.ralph-hooks/pre-push`
- **When** git invokes it with stdin line `refs/heads/ralph/rlf-x <sha> refs/heads/main 0000000000000000000000000000000000000000`
- **Then** the hook exits non-zero
- **And** stderr contains the substring `refs/heads/main` and the substring `ralph` (indicating the policy origin)

#### Scenario: hook allows non-force push to own branch

- **Given** an installed `.ralph-hooks/pre-push`
- **When** git invokes it with stdin line `refs/heads/ralph/rlf-x <sha> refs/heads/ralph/rlf-x 0000000000000000000000000000000000000000`
- **Then** the hook exits 0

#### Scenario: hook rejects force-push without override

- **Given** an installed `.ralph-hooks/pre-push`
- **And** the environment variable `RALPH_ALLOW_FORCE_PUSH` is unset
- **When** git invokes it with stdin line indicating a non-fast-forward update (remote sha is non-zero and not an ancestor of local sha) on `refs/heads/ralph/rlf-x`
- **Then** the hook exits non-zero
- **And** stderr names `RALPH_ALLOW_FORCE_PUSH` as the override

#### Scenario: hook allows force-push when ralph opts in

- **Given** an installed `.ralph-hooks/pre-push`
- **And** the environment variable `RALPH_ALLOW_FORCE_PUSH=1`
- **When** git invokes it with the same non-fast-forward push stdin
- **Then** the hook exits 0

#### Scenario: resume reinstalls the hook

- **Given** a worktree at `<cwd>` that already exists and was created before this change (no `.ralph-hooks/pre-push`)
- **When** `createWorktree` is called again with the same change name
- **Then** the returned handle's `cwd` equals `<cwd>`
- **And** `<cwd>/.ralph-hooks/pre-push` now exists and is executable
- **And** `core.hooksPath` is configured for that worktree
