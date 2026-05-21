# Tasks for RLF-107

## Planning

- [x] Read the Linear issue at https://linear.app/neriros/issue/RLF-107/worker-self-pushes-to-base-branch-force-pushes-own-branch-when-test and research the codebase to understand the mission and its scope
- [x] Refine proposal.md with the problem statement, approach, and acceptance criteria derived from the research
- [x] Fill in `## Why` and `## What Changes` in proposal.md so `openspec validate` passes (these sections are required by the validator)
- [x] Add at least one spec delta under `specs/<capability>/spec.md` describing the behavior added/modified/removed by this change
- [x] Fill in design.md with the technical design (files to touch, data flow, edge cases)
- [x] Append an `## Implementation` section below with concrete mission-specific tasks derived from the plan, including tests and `bun run lint` / `bun run test`. Every item in the new section MUST start as `- [ ]` (unchecked) — do not pre-check items even if you already did the work during planning. The loop ticks them off in later iterations after each one is verified.

## Implementation

- [x] Add `installPrePushHook(cwd, runner)` in `apps/agent/src/agent/worktree.ts` that (1) writes `<cwd>/.ralph-hooks/pre-push` via `Bun.write` with the hook script from design.md, (2) `Bun.spawn(["chmod", "+x", path])` to mark it executable, and (3) runs `git config core.hooksPath .ralph-hooks` inside the worktree. Export it from the module.
- [x] Call `installPrePushHook` from every return path inside `createWorktree` (reuse path, branch-exists path, fresh-create path) so resumed worktrees get upgraded.
- [x] Add unit test in `apps/agent/src/__tests__/worktree.test.ts` (or a new sibling file): with a recording `GitRunner` and a temp dir, assert the hook file is written + executable and that `git config core.hooksPath .ralph-hooks` was invoked for each return path.
- [x] Add `apps/agent/src/agent/__tests__/pre-push-hook.test.ts` that drives the installed hook script via `Bun.spawn` with each stdin line from the spec scenarios (allow ralph branch, deny main, deny force without override, allow force with override).
- [x] Update `apps/agent/src/shared/capabilities/__tests__/git.test.ts` if needed to ensure the capability wrapper still reports `git.worktree.create` success after the hook install step.
- [x] Manually verify against the test repo described in the ticket: spawn a worker in a worktree, attempt `git push origin main` from inside it, confirm it's rejected with the policy stderr.
- [x] Run `bunx openspec validate rlf-107-worker-self-pushes-to-base-branch-force` and ensure it passes.
- [x] Run `bun run lint` and fix any issues.
- [x] Run `bun run test` and ensure the full suite passes (no coverage threshold reduction).
- [x] Commit each touched file individually (no `git add -A`).
- [x] Push branch and open PR with title `rlf-107-worker-self-pushes-to-base-branch-force`.
