import { basename, join } from "node:path";
import { homedir } from "node:os";
import { exists } from "node:fs/promises";

interface WorktreeHandle {
  /** Absolute path to the new working tree. */
  cwd: string;
  /** Branch name created for this worktree. */
  branch: string;
}

export interface GitRunner {
  /** Run a git command in the given cwd. Throws on non-zero exit with stderr in message. */
  run: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

/**
 * Where worktrees live for a given project.
 *
 * Located at `~/.ralph/<project-basename>/worktrees`, OUTSIDE the project
 * tree. The project tree is unsuitable because users typically gitignore
 * `.ralph/`, and tools that walk up reading `.gitignore` (cspell with
 * `useGitignore`, lint-staged, etc.) then treat anything under `.ralph/`
 * as ignored — pre-push hooks running inside a worktree there find zero
 * files and fail spuriously. Living in `~/.ralph/...` keeps worktrees
 * out of any project-level gitignore reach.
 */
export function worktreesDir(projectRoot: string): string {
  return join(homedir(), ".ralph", basename(projectRoot), "worktrees");
}

/** Branch name used for a given change-name slug. */
export function branchForChange(changeName: string): string {
  return `ralph/${changeName}`;
}

/**
 * Create a new git worktree at `~/.ralph/<project>/worktrees/<changeName>` checked out
 * onto a fresh branch `ralph/<changeName>`. When the branch is being created,
 * `git fetch origin <baseBranch>` runs first and the new branch is rooted at
 * `origin/<baseBranch>` — not the local HEAD of `projectRoot` — so a stale or
 * dirty local checkout cannot leak into agent PRs. Returns the absolute
 * worktree path and branch name.
 *
 * If a worktree at that path already exists, it is reused (treated as
 * resume). If the branch already exists locally, it is checked out as-is
 * with no fetch and no silent rebase.
 *
 * Fails loudly when the fetch fails — better to surface a missing remote
 * than to silently fall back to local HEAD.
 */
export async function createWorktree(
  projectRoot: string,
  changeName: string,
  baseBranch: string,
  runner: GitRunner,
): Promise<WorktreeHandle> {
  const dir = worktreesDir(projectRoot);
  const cwd = join(dir, changeName);
  const branch = branchForChange(changeName);

  // If the worktree directory already exists in git's worktree list, reuse it.
  const list = await runner.run(["worktree", "list", "--porcelain"], projectRoot);
  if (list.stdout.includes(`worktree ${cwd}\n`)) {
    await installPrePushHook(cwd, runner);
    return { cwd, branch };
  }

  // Does the branch already exist locally?
  let branchExists = true;
  try {
    await runner.run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot);
  } catch {
    branchExists = false;
  }

  if (branchExists) {
    await runner.run(["worktree", "add", cwd, branch], projectRoot);
    await installPrePushHook(cwd, runner);
    return { cwd, branch };
  }

  await runner.run(["fetch", "origin", baseBranch], projectRoot);
  await runner.run(["worktree", "add", "-b", branch, cwd, `origin/${baseBranch}`], projectRoot);
  await installPrePushHook(cwd, runner);
  return { cwd, branch };
}

/**
 * Hook script body installed into each worktree's `.ralph-hooks/pre-push`.
 *
 * Reads git's per-push stdin (`<local ref> <local sha> <remote ref> <remote sha>`)
 * and rejects pushes that target anything other than `refs/heads/ralph/*`,
 * and rejects force pushes unless `RALPH_ALLOW_FORCE_PUSH=1` is set.
 */
export const PRE_PUSH_HOOK_SCRIPT = `#!/usr/bin/env bash
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
  if [ "$remote_sha" != "$ZERO" ] && [ "\${RALPH_ALLOW_FORCE_PUSH:-0}" != "1" ]; then
    if ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
      echo "ralph: refusing force-push to $remote_ref (set RALPH_ALLOW_FORCE_PUSH=1 to override)" >&2
      exit 1
    fi
  fi
done
exit 0
`;

/**
 * Install the per-worktree pre-push hook that constrains worker subprocesses
 * to pushing only `refs/heads/ralph/*` and (by default) non-force pushes.
 *
 * Idempotent: overwrites any existing file with the canonical script, marks
 * it executable, and points the worktree's `core.hooksPath` at the directory.
 * Called from every return path of `createWorktree` so that resumed worktrees
 * pick up the hook on the next iteration.
 */
export async function installPrePushHook(cwd: string, runner: GitRunner): Promise<void> {
  const hookPath = join(cwd, ".ralph-hooks", "pre-push");
  await Bun.write(hookPath, PRE_PUSH_HOOK_SCRIPT);
  const chmod = Bun.spawn(["chmod", "+x", hookPath]);
  await chmod.exited;
  await runner.run(["config", "core.hooksPath", ".ralph-hooks"], cwd);
}

/**
 * Remove a worktree (and prune any stale entries). Best-effort: a failure
 * here should not block higher-level cleanup, so callers typically swallow
 * the error and log instead.
 */
export async function removeWorktree(
  projectRoot: string,
  cwd: string,
  runner: GitRunner,
): Promise<void> {
  await runner.run(["worktree", "remove", "--force", cwd], projectRoot);
}

interface WorktreeCleanupCheck {
  safe: boolean;
  /** Why removal is unsafe (only set when safe=false). */
  reason?: string;
  /** `git status --porcelain` output (uncommitted/untracked entries). */
  dirty: string;
  /** `git log <base>..HEAD --oneline` output (commits not on base). */
  unpushedCommits: string;
}

/**
 * Decide whether a worktree is safe to delete. A worktree is only safe to
 * remove when both:
 *   - the working tree is fully clean (no uncommitted or untracked files),
 *   - there are no commits ahead of `base` (so nothing was produced that
 *     hasn't already been merged or PR'd).
 *
 * If either check fails, callers MUST preserve the worktree — `git worktree
 * remove --force` would otherwise destroy unsaved work.
 */
export async function isWorktreeSafeToRemove(
  cwd: string,
  base: string,
  runner: GitRunner,
): Promise<WorktreeCleanupCheck> {
  const status = await runner.run(["status", "--porcelain"], cwd);
  const dirty = status.stdout.trim();

  let unpushedCommits = "";
  try {
    const log = await runner.run(["log", "--oneline", `${base}..HEAD`, "--no-merges"], cwd);
    unpushedCommits = log.stdout.trim();
  } catch {
    // base may not be reachable from HEAD (e.g. detached / unrelated histories).
    // Treat as "has commits we don't understand" — i.e. unsafe to delete.
    unpushedCommits = "<unknown: failed to compare against base>";
  }

  if (dirty && unpushedCommits) {
    return {
      safe: false,
      reason: "uncommitted changes AND unpushed commits present",
      dirty,
      unpushedCommits,
    };
  }
  if (dirty) {
    return {
      safe: false,
      reason: "uncommitted or untracked files present",
      dirty,
      unpushedCommits,
    };
  }
  if (unpushedCommits) {
    return {
      safe: false,
      reason: `commits ahead of ${base} were not pushed/PR'd`,
      dirty,
      unpushedCommits,
    };
  }
  return { safe: true, dirty, unpushedCommits };
}

/**
 * Seed the worktree's `.mcp.json` so engines spawned inside the worktree see
 * the ralphy MCP server. `.ralph/bin/mcp.js` is gitignored, so any relative
 * `.ralph/...` arg in the worktree's `.mcp.json` won't resolve from inside
 * the worktree.
 *
 * Read whichever `.mcp.json` is available (preferring the worktree's own
 * checked-in copy, falling back to the project root's), rewrite any
 * relative `.ralph/...` args to absolute paths under `projectRoot`, and
 * write the result into the worktree. No-op if neither exists.
 */
export async function seedWorktreeMcpConfig(
  projectRoot: string,
  worktreeCwd: string,
): Promise<void> {
  const dst = join(worktreeCwd, ".mcp.json");
  const src = join(projectRoot, ".mcp.json");
  const source = (await exists(dst)) ? dst : (await exists(src)) ? src : null;
  if (!source) return;
  let parsed: { mcpServers?: Record<string, { args?: unknown[] }> };
  try {
    parsed = await Bun.file(source).json();
  } catch {
    return;
  }
  const servers = parsed.mcpServers;
  if (servers && typeof servers === "object") {
    for (const cfg of Object.values(servers)) {
      if (Array.isArray(cfg.args)) {
        cfg.args = cfg.args.map((a) =>
          typeof a === "string" && a.startsWith(".ralph/") ? join(projectRoot, a) : a,
        );
      }
    }
  }
  await Bun.write(dst, JSON.stringify(parsed, null, 2) + "\n");
}
