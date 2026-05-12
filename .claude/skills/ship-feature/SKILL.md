---
name: ship-feature
description: End-to-end ship a feature in this repo — fresh branch from main, local CI gates, commit + push, PR with body, wait for CI, squash-merge, tag at main HEAD, wait for npm publish, verify. Use when the user says "ship this", "release a new version", "create a PR and publish", or describes a code change that should land on npm.
user-invocable: true
argument-hint: [version-bump-type] (patch|minor|major, default: patch)
---

Ship a code change end-to-end through this repo's release workflow. Follow these steps in order. Stop and report immediately if any step fails — do NOT improvise around CI failures.

## 0. Decide the branch & version

- **Always start on a fresh branch from `origin/main`.** Never edit on `main` directly.

  ```bash
  git fetch origin main
  git checkout -b <descriptive-branch-name> origin/main
  ```

  Branch names: short, kebab-case, scoped (`agent-fix-ci-loop`, `docs-readme-agent-mode`, `feat-worktree-per-task`).

- **Bump version in `package.json`** (root only — workspace packages stay at 0.0.0). Default to a patch bump unless the user specifies otherwise:
  - `patch` (2.7.X → 2.7.X+1) — fixes, small additions, docs+behavior tweaks
  - `minor` (2.X.0 → 2.X+1.0) — substantial new features
  - `major` — breaking changes (rare; confirm with user)

  The publish workflow reads version from `package.json` at the tag's commit, so this MUST be bumped in the same commit as the change.

## 1. Make the change

Edit code, add/update tests, and update README if any user-facing behavior changes. Match the existing style — see neighboring files.

**README is required when** the change touches any of:

- A new or renamed `ralphy.config.json` field (root or under `linear.*` / `linear.indicators.*`). Update the indicator table at the top of `### Linear indicators` AND the example `ralphy.config.json` block AND the `### PR + CI integration` table — whichever applies.
- A new or renamed CLI flag, mode, or `--indicator` key.
- A new Linear label / status convention Ralph reacts to (e.g. `ralph:branch:<name>`, `ralph:auto-merge`). Document the label _and_ what config it ties to.
- A new lifecycle phase, post-task action, or external command Ralph runs (e.g. `gh pr merge`).
- Behavior change to an existing user-visible feature (PR creation, CI fix loop, conflict scan, worktree cleanup, etc.).

Search the README before claiming "no README update needed":

```bash
grep -nE '<new-flag>|<new-config-key>|<new-label>' README.md
```

Empty grep + user-visible feature = README is stale. Skip the update only for pure internal refactors, test-only changes, or fixes that don't alter documented behavior.

## 2. Run every CI gate locally before pushing

CI runs the same suite remotely; finding failures here saves a round-trip. Run them in this order from the repo root:

```bash
# 1. Format
bunx oxfmt apps/cli/src

# 2. Typecheck
bunx nx run cli:typecheck --skip-nx-cache

# 3. Knip (unused exports / deps)
bun run check:unused:ci

# 4. Spell check
bunx cspell "apps/cli/src/**/*.{ts,tsx}" --no-progress

# 5. Static error-message check
bun scripts/check-static-error-messages.ts

# 6. Tests + coverage (the affected-files script also runs in CI)
cd apps/cli && bun test --coverage
```

**All must exit 0.** Common gotchas:

- **Knip**: types/exports referenced only in tests still count as unused if marked `export`. Drop the `export` keyword and let TS infer through callers.
- **Spell**: add unknown technical words to `cspell.json` `words` array (alphabetical-ish, no duplicates).
- **Coverage**: per-file threshold is 90% lines / 90% functions in `apps/cli/bunfig.toml`. AgentMode.tsx is excluded as a thin Ink/spawn adapter — keep new orchestration logic in `apps/cli/src/agent/*.ts` so it stays unit-testable. Inject deps (`GitRunner`, `CmdRunner`, etc.) so tests can mock without spawning real processes.
- **Static errors**: `Error()` constructors must take a static string. Put dynamic context on the error object as fields (see `apps/cli/src/agent/linear.ts` `linearRequest` for the pattern).
- **Typecheck**: the project uses `exactOptionalPropertyTypes` and `allowUnreachableCode: false`. Optional fields must be typed as `field?: T | undefined`, not just `field?: T`.

## 3. Commit and push

```bash
git add -A
git commit -m "$(cat <<'EOF'
<type>: <one-line summary>

<2-5 paragraph explanation: what changed, why, any tradeoffs.
Reference the user-visible config keys / CLI flags introduced.
List new tests and what they cover.>

Bump @neriros/ralphy <old> -> <new>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin <branch-name>
```

The husky pre-commit hook runs `oxfmt`/`oxlint`/`secretlint` on staged files; if it complains, fix and re-commit (don't `--no-verify`).

## 4. Open the PR

```bash
gh pr create --title "<type>: <summary> (v<new-version>)" --body "$(cat <<'EOF'
## Summary
<one-paragraph elevator pitch>

## What's in it
- <bullet per significant change>
- <reference new files / modules>
- <reference new config keys + CLI flags>

## Tests
- <list what was added>
- <test count> pass; coverage exit 0

## Version
\`@neriros/ralphy\` <old> → **<new>**

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Title format mirrors the conventional-commits style of recent merges: `feat: ... (vX.Y.Z)`, `fix: ... (vX.Y.Z)`, `docs: ... (vX.Y.Z)`, `chore: ... (vX.Y.Z)`.

## 5. Wait for CI to settle

Use a Monitor or background poll — never sleep-then-check. Example with the Bash background pattern:

```bash
until [ "$(gh pr checks <PR#> --json bucket --jq 'all(.bucket != "pending")')" = "true" ]; do sleep 10; done
gh pr checks <PR#>
```

Required green checks: `setup`, `static`, `test`, `build`, `ci` (aggregate). `GitGuardian Security Checks` should also pass. If any fails:

1. Inspect with `gh run view <run-id> --log-failed`
2. Fix on the same branch, push again
3. Wait for CI again

**Never bypass a failing check.**

## 6. Squash-merge

```bash
gh pr merge <PR#> --squash --delete-branch
```

Always squash (the project history uses squash merges; you can see this from `git log --oneline main`). The branch deletion step keeps the GitHub UI tidy.

## 7. Tag at the new main HEAD

```bash
git fetch origin main
HEAD_MAIN=$(git rev-parse origin/main)
git tag -a v<new-version> "$HEAD_MAIN" -m "v<new-version>: <one-line summary>"
git push origin v<new-version>
```

**Important**: tag the squashed merge commit on main, NOT the pre-squash branch HEAD. The publish workflow reads `package.json` at the tag's commit. The expected stderr `failed to run git: fatal: 'main' is already used by worktree at '...'` is harmless noise from another worktree — the tag still lands correctly. Verify with `git ls-remote --tags origin v<version>`.

## 8. Wait for the publish workflow + verify on npm

The `Publish to npm` workflow fires automatically on `v*` tag pushes (see `.github/workflows/publish.yml`).

```bash
RUN=$(gh run list --workflow=publish.yml --limit 1 --json databaseId --jq '.[0].databaseId')
until gh run view "$RUN" --json status --jq '.status' | grep -q completed; do sleep 5; done
gh run view "$RUN" --json conclusion --jq '.conclusion'
```

Expected `"success"`. Then verify the registry served the new version:

```bash
npm view @neriros/ralphy@<new-version> version
```

`npm view` may hit a stale local cache and show the previous version even when the registry has the new one. Cross-check with `npm view @neriros/ralphy time --json` (lists publish timestamps for every version). If the new version is in the timestamp map, it's live.

## 9. Report back to the user

One concise summary: PR # merged, tag pushed, publish workflow run-id + conclusion, npm version live. Link the PR and (optionally) the run.

## Repo-specific gotchas

- **Bun-only.** Use `Bun.spawn` / `Bun.file` / `Bun.write` over `node:child_process` / `node:fs` sync APIs. Test mocks should patch `Bun.spawnSync`, not `node:child_process`.
- **No `--no-verify`** on commits and no `--no-gpg-sign` — fix the underlying hook failure instead.
- **Worktree quirk**: this repo is often opened from a worktree, so `git checkout main` will fail with "already used by worktree". Don't try to switch — operate on `origin/main` via `git fetch` + `$(git rev-parse origin/main)` for tag commits. Branch creation works fine: `git checkout -b <new> origin/main`.
- **Coverage threshold is per-file (90% lines / 90% functions)**; the only file allowed below is `apps/cli/src/components/AgentMode.tsx` via `coveragePathIgnorePatterns` in `apps/cli/bunfig.toml`. Don't lower the threshold; instead extract pure logic into `apps/cli/src/agent/*.ts` modules with injectable deps and unit-test those.
- **Linear / GitHub side effects in agent mode are best-effort.** Failures must log and continue, never throw out of the task loop. Mirror the pattern in `apps/cli/src/agent/coordinator.ts` (`tagIssue`, `moveIssue`, `notifyExited`).

## Don't ship if

- Any local CI gate fails — fix first.
- The change includes secrets or `.env` content (secretlint should catch this; double-check).
- `coverageThreshold` in `apps/cli/bunfig.toml` was edited downward — never reduce the threshold.
- The user only asked for a draft / wants to review the PR before merging — stop after step 4 and surface the PR URL.
