## Fix failing CI checks (2026-05-28T09:08:00.570Z)

- [x] Fix failing CI checks. Read the error block below, fix the underlying problem (do not just retry the failing command), then check this box.

```
The PR for this change has failing CI checks.
Steps:
1. Inspect the failing checks: `gh pr checks https://github.com/rosneri/ralphy/pull/297` then
   `gh run view <run-id> --log-failed` for each red run.
2. Fix the underlying failures in the worktree (tests, lint, typecheck, build).
3. Stage and commit the fixes.
4. Push with `git push origin ralph/rlf-176`. If the push is rejected as
   non-fast-forward, `git fetch origin ralph/rlf-176` then `git merge origin/ralph/rlf-176`
   before retrying. Do NOT rebase, do NOT amend, and never force-push.
5. Wait for CI to re-run; if checks are still red, repeat from step 1.
   Stop only when CI is green or when the failure is clearly outside the change's scope
   (flaky infra, external service down) — in that case, log the rejection and exit.

PR: https://github.com/rosneri/ralphy/pull/297
```
